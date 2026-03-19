import { NextRequest, NextResponse } from 'next/server';
import { getProject, setIssueStage, type IssueStage } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { updateIssueLabels } from '@/lib/provider';

// stage → stage 전환 매핑
interface StageTransition {
  action: string;
  toStage: IssueStage;
  fromLabel: string;
  toLabel: string;
}

function getTransitions(project: any): Record<string, StageTransition[]> {
  return {
    waiting: [],
    dev: [
      { action: 'cancel', toStage: 'waiting', fromLabel: project.labelInProgress, toLabel: project.labelTarget },
    ],
    dev_fail: [
      { action: 'retry', toStage: 'waiting', fromLabel: project.labelFailDev, toLabel: project.labelTarget },
    ],
    done: [
      { action: 'reopen', toStage: 'waiting', fromLabel: project.labelDone, toLabel: project.labelTarget },
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

  // 1. 로컬 DB에 stage 업데이트 (항상 성공)
  setIssueStage(projectId, Number(iid), transition.toStage);

  // 2. 원격 레이블 업데이트 (best-effort — 실패해도 무시)
  try {
    const decryptedToken = decrypt(project.accessToken);
    await updateIssueLabels(
      project,
      Number(iid),
      decryptedToken,
      [transition.toLabel],
      [transition.fromLabel]
    );
  } catch (err) {
    console.warn(`[Stage] Remote label update failed for ${projectId}#${iid}:`, err instanceof Error ? err.message : err);
  }

  return NextResponse.json({ success: true, stage: transition.toStage });
}
