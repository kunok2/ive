import { Project } from "@/types";
import { getOwnerRepo, getGitHubAuthHeaders, apiUrl } from "./common";

/**
 * GitHub 프로젝트에 필요한 레이블들이 있는지 확인하고, 없으면 생성합니다.
 */
export async function ensureGitHubLabels(project: Project, decryptedToken: string) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) return;

  const headers = getGitHubAuthHeaders(project, decryptedToken);
  const labelsToEnsure = [
    { name: project.labelTarget, color: '34d399', description: 'IVE 관리 대상 이슈 표시.' },
    { name: project.labelSchedule || 'IVE-S', color: 'fbbf24', description: '스케줄 대기. 스캐너가 이 레이블의 이슈를 에이전트에 배정합니다.' },
    { name: project.labelDev || 'IVE-D', color: '22d3ee', description: '개발 중. 에이전트가 작업을 시작하면 자동 부착됩니다.' },
    { name: project.labelVerifyWait || 'IVE-W', color: 'eab308', description: '검증대기. 개발이 완료되어 검증자의 검증시작을 기다리고 있습니다.' },
    { name: project.labelVerify || 'IVE-V', color: 'fb923c', description: '검증 중. 검증자가 검증을 진행하고 있습니다.' },
    { name: project.labelConfirmWait || 'IVE-P', color: 'eab308', description: '확인대기. 머지가 완료되어 확인자의 실환경 확인을 기다리고 있습니다.' },
    { name: project.labelConfirm || 'IVE-C', color: 'fb923c', description: '확인 중. 확인자가 실환경에서 동작을 직접 확인하고 있습니다.' },
    { name: project.labelEnd || 'IVE-E', color: '60a5fa', description: '처리 완료. 확인까지 마친 최종 완료 상태입니다.' },
    { name: project.labelNotify || 'IVE-N', color: '64748b', description: '완료 알림 대상. 이 레이블이 붙은 이슈는 처리 완료/실패 시 담당자에게 Slack 알림(DM·채널)을 보냅니다.' },
  ];

  try {
    // 전체 레이블 조회
    const res = await fetch(apiUrl(project, '/labels?per_page=100'), { headers });
    if (!res.ok) {
      if (res.status === 401) throw new Error('인증 정보가 유효하지 않거나 만료되었습니다. GitHub Personal Access Token을 확인해주세요.');
      throw new Error(`Failed to fetch labels: ${res.statusText}`);
    }
    const existingLabels: any[] = await res.json();
    const existingByName = new Map<string, any>(existingLabels.map(l => [l.name, l]));

    for (const label of labelsToEnsure) {
      const existing = existingByName.get(label.name);
      if (!existing) {
        // 신규 생성
        console.log(`[GitHub] Creating label: ${label.name} for project: ${project.name}`);
        await fetch(apiUrl(project, '/labels'), {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(label),
        });
      } else if ((existing.description || '') !== label.description) {
        // 기존 레이블의 설명이 비어있거나 다르면 덮어씀 (색상은 사용자 커스텀을 존중해 건드리지 않음)
        console.log(`[GitHub] Updating label description: ${label.name}`);
        await fetch(apiUrl(project, `/labels/${encodeURIComponent(label.name)}`), {
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
  const res = await fetch(apiUrl(project, `/issues/${issueNumber}/labels`), {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ labels }),
  });
  return res.ok;
}

export async function removeGitHubIssueLabels(project: Project, issueNumber: number, decryptedToken: string, label: string) {
  const headers = getGitHubAuthHeaders(project, decryptedToken);
  const res = await fetch(apiUrl(project, `/issues/${issueNumber}/labels/${encodeURIComponent(label)}`), {
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
    const res = await fetch(apiUrl(project, `/issues/${issueNumber}/events?per_page=100`), { headers });
    if (!res.ok) return [];
    const events: any[] = await res.json();
    return events
      .filter(e => (e?.event === 'labeled' || e?.event === 'unlabeled') && e?.label?.name)
      .map(e => ({
        action: e.event === 'labeled' ? 'add' : 'remove',
        label: e.label.name,
        userId: e.actor?.id != null ? String(e.actor.id) : null,
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
    project.labelSchedule || 'IVE-S', project.labelDev || 'IVE-D',
    project.labelVerifyWait || 'IVE-W', project.labelVerify || 'IVE-V',
    project.labelConfirmWait || 'IVE-P', project.labelConfirm || 'IVE-C',
    project.labelEnd || 'IVE-E', project.labelNotify || 'IVE-N',
  ];
  try {
    const res = await fetch(apiUrl(project, '/labels?per_page=100'), { headers });
    if (!res.ok) return labelsToCheck.map(l => ({ label: l, exists: false }));
    const existing = (await res.json()).map((l: any) => l.name);
    return labelsToCheck.map(l => ({ label: l, exists: existing.includes(l) }));
  } catch {
    return labelsToCheck.map(l => ({ label: l, exists: false }));
  }
}
