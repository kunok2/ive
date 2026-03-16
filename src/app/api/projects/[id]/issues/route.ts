import { NextRequest, NextResponse } from 'next/server';
import { getProject } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { createGitLabIssue, fetchAllIveIssues } from '@/lib/gitlab';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  try {
    const decryptedToken = decrypt(project.accessToken);
    const issues = await fetchAllIveIssues(project, decryptedToken);

    // 각 이슈에 stage 정보 부여
    const stageMap: Record<string, string> = {
      [project.labelTarget]: 'waiting',
      [project.labelInProgress]: 'dev',
      [project.labelFailDev]: 'dev_fail',
      [project.labelValidation]: 'validation',
      [project.labelFailVal]: 'val_fail',
      [project.labelDone]: 'done',
    };

    const mapped = issues.map((issue: any) => {
      let stage = 'unknown';
      for (const label of issue.labels || []) {
        if (stageMap[label]) {
          stage = stageMap[label];
          break;
        }
      }
      return {
        iid: issue.iid,
        title: issue.title,
        description: issue.description,
        state: issue.state,
        stage,
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
  const { id: projectId } = await params;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const { title, description, asDev } = await req.json();
  if (!title?.trim()) return NextResponse.json({ error: '제목을 입력하세요.' }, { status: 400 });

  try {
    const decryptedToken = decrypt(project.accessToken);
    const labels = asDev ? [project.labelTarget] : [];
    const issue = await createGitLabIssue(project, decryptedToken, title.trim(), description?.trim() ?? '', labels);
    return NextResponse.json(issue);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '이슈 생성 실패' }, { status: 500 });
  }
}
