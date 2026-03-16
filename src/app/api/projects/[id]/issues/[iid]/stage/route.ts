import { NextRequest, NextResponse } from 'next/server';
import { getProject } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { updateGitLabIssueLabels } from '@/lib/gitlab';

// 단계 전환 매핑
// action: 사용자가 선택할 수 있는 액션명
// from → to: 레이블 변경
interface StageTransition {
  action: string;
  fromLabel: string;
  toLabel: string;
}

function getTransitions(project: any): Record<string, StageTransition[]> {
  return {
    // 대기 상태에서는 수동 전환 없음 (자동 스캐너가 처리)
    waiting: [],
    // 개발 중 → 강제로 되돌리기 가능
    dev: [
      { action: 'cancel', fromLabel: project.labelInProgress, toLabel: project.labelTarget },
    ],
    // 개발 실패 → 재시도(대기로) 가능
    dev_fail: [
      { action: 'retry', fromLabel: project.labelFailDev, toLabel: project.labelTarget },
    ],
    // 검증 대기
    validation: [
      { action: 'reject', fromLabel: project.labelValidation, toLabel: project.labelTarget },
    ],
    // 검증 실패 → 재검증 또는 재개발
    val_fail: [
      { action: 'revalidate', fromLabel: project.labelFailVal, toLabel: project.labelValidation },
      { action: 'retry', fromLabel: project.labelFailVal, toLabel: project.labelTarget },
    ],
    // 완료 → 다시 검증 요청
    done: [
      { action: 'revalidate', fromLabel: project.labelDone, toLabel: project.labelValidation },
      { action: 'reopen', fromLabel: project.labelDone, toLabel: project.labelTarget },
    ],
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string }> }
) {
  const { id: projectId, iid } = await params;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const { stage, action } = await req.json();
  if (!stage || !action) {
    return NextResponse.json({ error: 'stage와 action이 필요합니다.' }, { status: 400 });
  }

  const transitions = getTransitions(project);
  const available = transitions[stage];
  if (!available) {
    return NextResponse.json({ error: '알 수 없는 단계입니다.' }, { status: 400 });
  }

  const transition = available.find(t => t.action === action);
  if (!transition) {
    return NextResponse.json({ error: '허용되지 않는 액션입니다.' }, { status: 400 });
  }

  try {
    const decryptedToken = decrypt(project.accessToken);
    await updateGitLabIssueLabels(
      project,
      Number(iid),
      decryptedToken,
      [transition.toLabel],
      [transition.fromLabel]
    );
    return NextResponse.json({ success: true, from: transition.fromLabel, to: transition.toLabel });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '단계 변경 실패' }, { status: 500 });
  }
}
