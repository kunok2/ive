import { gitFetch } from "@/lib/git-fetch";
import { Project } from "@/types";
import { getProjectPath, getAuthHeaders, apiUrl } from "./common";
import { fetchAllPages } from "@/lib/git-paging";
import { DEFAULT_LABELS } from "@/lib/labels";

/**
 * GitLab 프로젝트에 필요한 레이블들이 있는지 확인하고, 없으면 생성합니다.
 */
export async function ensureGitLabLabels(project: Project, decryptedToken: string) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return;

  const headers = getAuthHeaders(project, decryptedToken);
  // GitLab/GitHub 레이블 색상 — IVE 디자인 토큰과 동일한 의미 매핑
  // (cyan=정보/대기, amber=진행/검증, green=완료) — 토큰 hex 값과 정확히 일치
  const labelsToEnsure = [
    { name: project.labelTarget, color: '#22d3ee', description: 'IVE 관리 대상 이슈 표시.' },
    { name: project.labelSchedule || DEFAULT_LABELS.schedule, color: '#22d3ee', description: '스케줄 대기. 스캐너가 이 레이블의 이슈를 에이전트에 배정합니다.' },
    { name: project.labelDev || DEFAULT_LABELS.dev, color: '#f59e0b', description: '개발 중. 에이전트가 작업을 시작하면 자동 부착됩니다.' },
    { name: project.labelVerifyWait || DEFAULT_LABELS.verifyWait, color: '#f59e0b', description: '검증대기. 개발이 완료되어 검증자의 검증시작을 기다리고 있습니다.' },
    { name: project.labelVerify || DEFAULT_LABELS.verify, color: '#f59e0b', description: '검증 중. 검증자가 검증을 진행하고 있습니다.' },
    { name: project.labelConfirmWait || DEFAULT_LABELS.confirmWait, color: '#f59e0b', description: '확인대기. 머지가 완료되어 확인자의 실환경 확인을 기다리고 있습니다.' },
    { name: project.labelConfirm || DEFAULT_LABELS.confirm, color: '#f59e0b', description: '확인 중. 확인자가 실환경에서 동작을 직접 확인하고 있습니다.' },
    { name: project.labelEnd || DEFAULT_LABELS.end, color: '#4ade80', description: '처리 완료. 확인까지 마친 최종 완료 상태입니다.' },
    { name: project.labelNotify || DEFAULT_LABELS.notify, color: '#64748b', description: '완료 알림 대상. 이 레이블이 붙은 이슈는 처리 완료/실패 시 담당자에게 Slack 알림(DM·채널)을 보냅니다.' },
  ];

  try {
    const res = await fetchAllPages(apiUrl(project, '/labels'), headers);

    if (!res.ok) {
      if (res.status === 401) throw new Error('인증 정보가 유효하지 않거나 만료되었습니다. GitLab Personal Access Token을 확인해주세요.');
      throw new Error(`Failed to fetch labels: ${res.statusText}`);
    }
    const existingLabels: any[] = res.items;
    const existingByName = new Map<string, any>(existingLabels.map(l => [l.name, l]));

    for (const label of labelsToEnsure) {
      const existing = existingByName.get(label.name);
      if (!existing) {
        // 신규 생성
        console.log(`[GitLab] Creating label: ${label.name} for project: ${project.name}`);
        await gitFetch(apiUrl(project, '/labels'), {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(label)
        });
      } else if ((existing.description || '') !== label.description) {
        // 기존 레이블의 설명이 비어있거나 다르면 덮어씀 (색상은 사용자 커스텀을 존중해 건드리지 않음)
        // GitLab API: PUT /projects/:id/labels/:label_id (id는 숫자 또는 URL-encoded name)
        console.log(`[GitLab] Updating label description: ${label.name}`);
        await gitFetch(apiUrl(project, `/labels/${encodeURIComponent(label.name)}`), {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: label.description }),
        });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[GitLab] Label sync failed for ${project.name}: ${msg}`);
  }
}

export async function addGitLabIssueLabels(project: Project, issueIid: number, decryptedToken: string, labels: string[]) {
  const headers = getAuthHeaders(project, decryptedToken);
  // GitLab: PUT으로 기존 레이블에 추가
  const res = await gitFetch(apiUrl(project, `/issues/${issueIid}`), {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ add_labels: labels.join(',') }),
  });
  return res.ok;
}

export async function removeGitLabIssueLabels(project: Project, issueIid: number, decryptedToken: string, labels: string[]) {
  const headers = getAuthHeaders(project, decryptedToken);
  const res = await gitFetch(apiUrl(project, `/issues/${issueIid}`), {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ remove_labels: labels.join(',') }),
  });
  return res.ok;
}

/** 붙이기·떼기를 한 번의 요청으로 — 중간에 단계 라벨이 비는 순간이 없다(스캐너가 그 순간을 「단계 없음」으로 읽지 않게) */
export async function swapGitLabIssueLabels(project: Project, issueIid: number, decryptedToken: string, add: string[], remove: string[]) {
  const headers = getAuthHeaders(project, decryptedToken);
  const res = await gitFetch(apiUrl(project, `/issues/${issueIid}`), {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(add.length ? { add_labels: add.join(',') } : {}), ...(remove.length ? { remove_labels: remove.join(',') } : {}) }),
  });
  return res.ok;
}

export interface IssueLabelEvent {
  action: 'add' | 'remove'
  label: string
  /** Provider 측 사용자 ID (string 화). 익명/시스템 이벤트면 null. */
  userId: string | null
  /**
   * Provider 측 사용자명. userId(숫자 id) 매칭이 실패할 때의 fallback 식별자 —
   * 다른 provider 로 IVE 에 로그인한 사용자는 oauth_user_id 가 안 맞지만
   * gitlab_username/github_username 은 채워져 있을 수 있다.
   */
  username: string | null
  createdAt: string
}

/**
 * 이슈의 레이블 부착/제거 이벤트 목록을 시간순으로 반환.
 * "누가 IVE-S 를 달았는가" 같은 의뢰자 판정에 사용.
 */
export async function fetchGitLabIssueLabelEvents(
  project: Project,
  issueIid: number,
  decryptedToken: string,
): Promise<IssueLabelEvent[]> {
  const headers = getAuthHeaders(project, decryptedToken);
  try {
    const res = await fetchAllPages(apiUrl(project, `/issues/${issueIid}/resource_label_events`), headers);
    if (!res.ok) return [];
    const events: any[] = res.items;
    return events
      .filter(e => e?.label?.name)
      .map(e => ({
        action: e.action === 'add' ? 'add' : 'remove',
        label: e.label.name,
        userId: e.user?.id != null ? String(e.user.id) : null,
        username: e.user?.username ?? null,
        createdAt: e.created_at,
      } as IssueLabelEvent));
  } catch {
    return [];
  }
}

export async function checkGitLabLabelsExist(project: Project, decryptedToken: string): Promise<{ label: string; exists: boolean }[]> {
  const headers = getAuthHeaders(project, decryptedToken);
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
 * 프로젝트 레이블 이름을 바꾼다(붙어 있는 이슈는 그대로 새 이름을 단다).
 * - renamed: 바꿈 · already: 새 이름만 있음(이미 바뀜) · absent: 둘 다 없음
 * 옛 이름·새 이름 레이블이 둘 다 있거나, 옛 레이블이 그룹 레이블(프로젝트에서 이름을 못 바꿈)이면 예외.
 */
export async function renameGitLabLabel(project: Project, decryptedToken: string, from: string, to: string): Promise<'renamed' | 'already' | 'absent'> {
  const headers = getAuthHeaders(project, decryptedToken);
  const list = await fetchAllPages(apiUrl(project, '/labels'), headers);
  if (!list.ok) throw new Error(`레이블 목록 조회 실패 (${list.status}): ${list.statusText}`);
  const oldL = list.items.find((l: any) => l.name === from);
  const newL = list.items.find((l: any) => l.name === to);
  if (!oldL && !newL) return 'absent';
  if (!oldL) return 'already';
  if (newL) {
    throw new Error(`저장소에 「${from}」과 「${to}」 레이블이 둘 다 있어 이름을 바꿀 수 없습니다 — 하나를 정리한 뒤 다시 저장하세요.`);
  }
  if (oldL.is_project_label === false) {
    throw new Error(`「${from}」은 그룹 레이블이라 프로젝트에서 이름을 바꿀 수 없습니다 — 그룹 설정에서 바꾸거나 다른 이름을 쓰세요.`);
  }
  const res = await gitFetch(apiUrl(project, `/labels/${oldL.id}`), {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_name: to }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`레이블 「${from}」 → 「${to}」 이름 변경 실패 (${res.status}): ${body.slice(0, 200)}`);
  }
  return 'renamed';
}
