import { Project } from "@/types";
import { getProjectPath, getAuthHeaders, apiUrl } from "./common";

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
    { name: project.labelSchedule || 'IVE-S', color: '#22d3ee', description: '스케줄 대기. 스캐너가 이 레이블의 이슈를 에이전트에 배정합니다.' },
    { name: project.labelDev || 'IVE-D', color: '#f59e0b', description: '개발 중. 에이전트가 작업을 시작하면 자동 부착됩니다.' },
    { name: project.labelVerifyWait || 'IVE-W', color: '#f59e0b', description: '검증대기. 개발이 완료되어 검증자의 검증시작을 기다리고 있습니다.' },
    { name: project.labelVerify || 'IVE-V', color: '#f59e0b', description: '검증 중. 검증자가 검증을 진행하고 있습니다.' },
    { name: project.labelEnd || 'IVE-E', color: '#4ade80', description: '처리 완료. 코드가 수정되었으면 MR/PR 머지 대상입니다.' },
  ];

  try {
    const res = await fetch(apiUrl(project, '/labels'), { headers });

    if (!res.ok) {
      if (res.status === 401) throw new Error('인증 정보가 유효하지 않거나 만료되었습니다. GitLab Personal Access Token을 확인해주세요.');
      throw new Error(`Failed to fetch labels: ${res.statusText}`);
    }
    const existingLabels: any[] = await res.json();
    const existingByName = new Map<string, any>(existingLabels.map(l => [l.name, l]));

    for (const label of labelsToEnsure) {
      const existing = existingByName.get(label.name);
      if (!existing) {
        // 신규 생성
        console.log(`[GitLab] Creating label: ${label.name} for project: ${project.name}`);
        await fetch(apiUrl(project, '/labels'), {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(label)
        });
      } else if ((existing.description || '') !== label.description) {
        // 기존 레이블의 설명이 비어있거나 다르면 덮어씀 (색상은 사용자 커스텀을 존중해 건드리지 않음)
        // GitLab API: PUT /projects/:id/labels/:label_id (id는 숫자 또는 URL-encoded name)
        console.log(`[GitLab] Updating label description: ${label.name}`);
        await fetch(apiUrl(project, `/labels/${encodeURIComponent(label.name)}`), {
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
  const res = await fetch(apiUrl(project, `/issues/${issueIid}`), {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ add_labels: labels.join(',') }),
  });
  return res.ok;
}

export async function removeGitLabIssueLabels(project: Project, issueIid: number, decryptedToken: string, labels: string[]) {
  const headers = getAuthHeaders(project, decryptedToken);
  const res = await fetch(apiUrl(project, `/issues/${issueIid}`), {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ remove_labels: labels.join(',') }),
  });
  return res.ok;
}

export async function checkGitLabLabelsExist(project: Project, decryptedToken: string): Promise<{ label: string; exists: boolean }[]> {
  const headers = getAuthHeaders(project, decryptedToken);
  const labelsToCheck = [
    project.labelTarget,
    project.labelSchedule || 'IVE-S', project.labelDev || 'IVE-D',
    project.labelVerifyWait || 'IVE-W', project.labelVerify || 'IVE-V', project.labelEnd || 'IVE-E',
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
