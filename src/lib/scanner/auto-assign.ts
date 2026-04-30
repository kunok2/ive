/**
 * 자동배정: 같은 프로젝트의 열린 이슈 중 본인에게 배정된 개수가 가장 적은
 * 프로젝트 멤버를 골라 assignee 로 지정한다.
 */
import { getLogger } from "../logger";
const slog = getLogger("AutoAssign");
import { Project } from "@/types";
import { fetchProjectMembers, fetchAllProjectIssues, updateIssue, addIssueComment } from "../provider";
import { setAssigneeAuto } from "../db";

export interface AutoAssignResult {
  username: string;
  name: string;
  count: number;
}

export async function runAutoAssign(
  project: Project,
  iid: number,
  token: string,
): Promise<AutoAssignResult | null> {
  const members = await fetchProjectMembers(project, token);
  if (!members.length) return null;

  const issues = await fetchAllProjectIssues(project, token);
  const counts = new Map<string, number>();
  for (const m of members) counts.set(m.username, 0);

  for (const issue of issues) {
    if (issue.iid === iid) continue;
    for (const a of (issue.assignees || [])) {
      const key: string = a.username || a.login;
      if (key && counts.has(key)) counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  const sorted = Array.from(counts.entries()).sort((a, b) => {
    if (a[1] !== b[1]) return a[1] - b[1];
    return a[0].localeCompare(b[0]);
  });
  const [pickedUsername, pickedCount] = sorted[0];
  const picked = members.find((m: { username: string }) => m.username === pickedUsername);
  if (!picked) return null;

  await updateIssue(project, iid, token, {
    assigneeIds: picked.id ? [picked.id] : undefined,
    assignees: [picked.username],
  });

  // DB 플래그 해제 (이제 명시적 담당자가 정해졌으므로)
  setAssigneeAuto(project.id, iid, false);

  // 안내 코멘트
  try {
    const note = `<!-- ive-bot -->\n## 🎯 담당자 자동 배정\n\n@${picked.username} 님이 자동 배정되었습니다.\n현재 열린 이슈 배정 수가 ${pickedCount}건으로 가장 적었습니다.`;
    await addIssueComment(project, iid, token, note);
  } catch (e) {
    slog.warn({ err: e }, `[AutoAssign] Failed to add note on #${iid}:`);
  }

  return { username: picked.username, name: picked.name || picked.username, count: pickedCount };
}
