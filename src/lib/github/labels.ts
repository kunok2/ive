import { gitFetch } from "@/lib/git-fetch";
import { Project } from "@/types";
import { getOwnerRepo, getGitHubAuthHeaders, apiUrl } from "./common";
import { fetchAllPages } from "@/lib/git-paging";
import { DEFAULT_LABELS } from "@/lib/labels";

/**
 * GitHub 프로젝트에 필요한 레이블들이 있는지 확인하고, 없으면 생성합니다.
 */
export async function ensureGitHubLabels(project: Project, decryptedToken: string) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) return;

  const headers = getGitHubAuthHeaders(project, decryptedToken);
  const labelsToEnsure = [
    { name: project.labelTarget, color: '34d399', description: 'IVE 관리 대상 이슈 표시.' },
    { name: project.labelSchedule || DEFAULT_LABELS.schedule, color: 'fbbf24', description: '스케줄 대기. 스캐너가 이 레이블의 이슈를 에이전트에 배정합니다.' },
    { name: project.labelDev || DEFAULT_LABELS.dev, color: '22d3ee', description: '개발 중. 에이전트가 작업을 시작하면 자동 부착됩니다.' },
    { name: project.labelVerifyWait || DEFAULT_LABELS.verifyWait, color: 'eab308', description: '검증대기. 개발이 완료되어 검증자의 검증시작을 기다리고 있습니다.' },
    { name: project.labelVerify || DEFAULT_LABELS.verify, color: 'fb923c', description: '검증 중. 검증자가 검증을 진행하고 있습니다.' },
    { name: project.labelConfirmWait || DEFAULT_LABELS.confirmWait, color: 'eab308', description: '확인대기. 머지가 완료되어 확인자의 실환경 확인을 기다리고 있습니다.' },
    { name: project.labelConfirm || DEFAULT_LABELS.confirm, color: 'fb923c', description: '확인 중. 확인자가 실환경에서 동작을 직접 확인하고 있습니다.' },
    { name: project.labelEnd || DEFAULT_LABELS.end, color: '60a5fa', description: '처리 완료. 확인까지 마친 최종 완료 상태입니다.' },
    { name: project.labelNotify || DEFAULT_LABELS.notify, color: '64748b', description: '완료 알림 대상. 이 레이블이 붙은 이슈는 처리 완료/실패 시 담당자에게 Slack 알림(DM·채널)을 보냅니다.' },
  ];

  try {
    // 전체 레이블 조회
    const res = await fetchAllPages(apiUrl(project, '/labels'), headers);
    if (!res.ok) {
      if (res.status === 401) throw new Error('인증 정보가 유효하지 않거나 만료되었습니다. GitHub Personal Access Token을 확인해주세요.');
      throw new Error(`Failed to fetch labels: ${res.statusText}`);
    }
    const existingLabels: any[] = res.items;
    const existingByName = new Map<string, any>(existingLabels.map(l => [l.name, l]));

    for (const label of labelsToEnsure) {
      const existing = existingByName.get(label.name);
      if (!existing) {
        // 신규 생성
        console.log(`[GitHub] Creating label: ${label.name} for project: ${project.name}`);
        await gitFetch(apiUrl(project, '/labels'), {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(label),
        });
      } else if ((existing.description || '') !== label.description) {
        // 기존 레이블의 설명이 비어있거나 다르면 덮어씀 (색상은 사용자 커스텀을 존중해 건드리지 않음)
        console.log(`[GitHub] Updating label description: ${label.name}`);
        await gitFetch(apiUrl(project, `/labels/${encodeURIComponent(label.name)}`), {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: label.description }),
        });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[GitHub] Label sync failed for ${project.name}: ${msg}`);
  }
}

export async function addGitHubIssueLabels(project: Project, issueNumber: number, decryptedToken: string, labels: string[]) {
  const headers = getGitHubAuthHeaders(project, decryptedToken);
  const res = await gitFetch(apiUrl(project, `/issues/${issueNumber}/labels`), {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ labels }),
  });
  return res.ok;
}

export async function removeGitHubIssueLabels(project: Project, issueNumber: number, decryptedToken: string, label: string) {
  const headers = getGitHubAuthHeaders(project, decryptedToken);
  const res = await gitFetch(apiUrl(project, `/issues/${issueNumber}/labels/${encodeURIComponent(label)}`), {
    method: 'DELETE',
    headers,
  });
  return res.ok;
}

export interface IssueLabelEvent {
  action: 'add' | 'remove'
  label: string
  /** Provider 측 사용자 ID (string 화). 익명/시스템 이벤트면 null. */
  userId: string | null
  /**
   * Provider 측 사용자명(GitHub 는 login). userId(숫자 id) 매칭이 실패할 때의
   * fallback 식별자 — 다른 provider 로 IVE 에 로그인한 사용자는 oauth_user_id 가
   * 안 맞지만 gitlab_username/github_username 은 채워져 있을 수 있다.
   */
  username: string | null
  createdAt: string
}

/**
 * 이슈의 레이블 부착/제거 이벤트 목록.
 * GitHub: GET /repos/:owner/:repo/issues/:n/events 에서 labeled/unlabeled 만 추림.
 */
export async function fetchGitHubIssueLabelEvents(
  project: Project,
  issueNumber: number,
  decryptedToken: string,
): Promise<IssueLabelEvent[]> {
  const headers = getGitHubAuthHeaders(project, decryptedToken);
  try {
    const res = await fetchAllPages(apiUrl(project, `/issues/${issueNumber}/events`), headers);
    if (!res.ok) return [];
    const events: any[] = res.items;
    return events
      .filter(e => (e?.event === 'labeled' || e?.event === 'unlabeled') && e?.label?.name)
      .map(e => ({
        action: e.event === 'labeled' ? 'add' : 'remove',
        label: e.label.name,
        userId: e.actor?.id != null ? String(e.actor.id) : null,
        username: e.actor?.login ?? null,
        createdAt: e.created_at,
      } as IssueLabelEvent));
  } catch {
    return [];
  }
}

export async function checkGitHubLabelsExist(project: Project, decryptedToken: string): Promise<{ label: string; exists: boolean }[]> {
  const headers = getGitHubAuthHeaders(project, decryptedToken);
  const labelsToCheck = [
    project.labelTarget,
    project.labelSchedule || DEFAULT_LABELS.schedule, project.labelDev || DEFAULT_LABELS.dev,
    project.labelVerifyWait || DEFAULT_LABELS.verifyWait, project.labelVerify || DEFAULT_LABELS.verify,
    project.labelConfirmWait || DEFAULT_LABELS.confirmWait, project.labelConfirm || DEFAULT_LABELS.confirm,
    project.labelEnd || DEFAULT_LABELS.end, project.labelNotify || DEFAULT_LABELS.notify,
  ];
  try {
    const res = await fetchAllPages(apiUrl(project, '/labels'), headers);
    if (!res.ok) return labelsToCheck.map(l => ({ label: l, exists: false }));
    const existing = res.items.map((l: any) => l.name);
    return labelsToCheck.map(l => ({ label: l, exists: existing.includes(l) }));
  } catch {
    return labelsToCheck.map(l => ({ label: l, exists: false }));
  }
}

/**
 * 저장소 레이블 이름을 바꾼다(붙어 있는 이슈는 그대로 새 이름을 단다).
 * GitHub 레이블 이름은 대소문자를 가리지 않으므로(IVE 와 ive 는 같은 레이블) 대소문자 비교로 찾는다.
 * - renamed: 바꿈 · already: 새 이름만 있음(이미 바뀜) · absent: 둘 다 없음
 * 옛 이름·새 이름 레이블이 둘 다 있으면 합칠 수 없어 예외.
 */
export async function renameGitHubLabel(project: Project, decryptedToken: string, from: string, to: string): Promise<'renamed' | 'already' | 'absent'> {
  const headers = getGitHubAuthHeaders(project, decryptedToken);
  const list = await fetchAllPages(apiUrl(project, '/labels'), headers);
  if (!list.ok) throw new Error(`레이블 목록 조회 실패 (${list.status}): ${list.statusText}`);
  const find = (name: string) => list.items.find((l: any) => String(l.name).toLowerCase() === name.toLowerCase());
  const oldL = find(from);
  const newL = find(to);
  const sameIgnoringCase = from.toLowerCase() === to.toLowerCase();
  if (!oldL && !newL) return 'absent';
  if (!oldL || (sameIgnoringCase && oldL.name === to)) return 'already';
  if (newL && !sameIgnoringCase) {
    throw new Error(`저장소에 「${oldL.name}」과 「${newL.name}」 레이블이 둘 다 있어 이름을 바꿀 수 없습니다 — 하나를 정리한 뒤 다시 저장하세요.`);
  }
  const res = await gitFetch(apiUrl(project, `/labels/${encodeURIComponent(oldL.name)}`), {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_name: to }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`레이블 「${oldL.name}」 → 「${to}」 이름 변경 실패 (${res.status}): ${body.slice(0, 200)}`);
  }
  return 'renamed';
}
