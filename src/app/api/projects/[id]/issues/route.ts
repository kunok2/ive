import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAccess, getIssueStages, setIssueStage } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { decrypt } from '@/lib/crypto';
import { fetchAllProjectIssues, createIssue } from '@/lib/provider';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  try {
    const decryptedToken = decrypt(project.accessToken);
    const issues = await fetchAllProjectIssues(project, decryptedToken);

    // 로컬 DB에서 stage 맵 로드
    const localStages = getIssueStages(projectId);

    // 원격 레이블 → stage 매핑 (로컬에 없는 이슈의 초기 등록용)
    const labelStageMap: Record<string, string> = {
      [project.labelTarget]: 'waiting',
      [project.labelInProgress]: 'dev',
      [project.labelFailDev]: 'dev_fail',
      [project.labelDone]: 'done',
    };

    const mapped = issues.map((issue: any) => {
      // 1. 로컬 DB에 stage가 있으면 우선 사용
      const local = localStages.get(issue.iid);
      let stage: string | null = local?.stage || null;
      let failReason: string | null = local?.failReason || null;

      // 2. 로컬에 없으면 원격 레이블에서 판단 후 DB에 등록
      if (!stage) {
        const issueLabels = issue.labels || [];
        for (const label of issueLabels) {
          if (labelStageMap[label]) {
            stage = labelStageMap[label];
            break;
          }
        }
        if (stage) {
          // 원격 레이블 기반 stage를 로컬 DB에 등록
          setIssueStage(projectId, issue.iid, stage as any);
        }
      }

      return {
        iid: issue.iid,
        title: issue.title,
        description: issue.description,
        state: issue.state,
        stage: stage || 'none',
        failReason,
        labels: issue.labels,
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        webUrl: issue.web_url,
        author: issue.author?.name,
      };
    });

    return NextResponse.json(mapped);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '이슈 조회 실패' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: projectId } = await params;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const access = getProjectAccess(projectId, user.id);
  if (!access || access === 'viewer') {
    return NextResponse.json({ error: '작업 생성 권한이 없습니다.' }, { status: 403 });
  }

  const { title, description, asDev } = await req.json();
  if (!title?.trim()) return NextResponse.json({ error: '제목을 입력하세요.' }, { status: 400 });

  try {
    const decryptedToken = decrypt(project.accessToken);
    const labels = asDev ? [project.labelTarget] : [];
    const issue = await createIssue(project, decryptedToken, title.trim(), description?.trim() ?? '', labels);

    // 이슈 생성 시 로컬 DB에 stage 등록
    if (asDev && issue.iid) {
      setIssueStage(projectId, issue.iid, 'waiting');
    }

    return NextResponse.json(issue);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '이슈 생성 실패' }, { status: 500 });
  }
}
