import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAccess, getIssueStages, setIssueStage, setPreferredAgent, getAgent } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { decrypt } from '@/lib/crypto';
import { fetchAllProjectIssues, fetchClosedProjectIssues, createIssue } from '@/lib/provider';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: projectId } = await params;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  if (!getProjectAccess(projectId, user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const stateParam = req.nextUrl.searchParams.get('state');

  try {
    const decryptedToken = decrypt(project.accessToken);
    const issues = stateParam === 'closed'
      ? await fetchClosedProjectIssues(project, decryptedToken)
      : await fetchAllProjectIssues(project, decryptedToken);

    // 로컬 DB에서 stage 맵 로드
    const localStages = getIssueStages(projectId);

    const mapped = issues.map((issue: any) => {
      // 로컬 DB에서 stage 조회 (상태는 로컬 DB로만 관리)
      const local = localStages.get(issue.iid);
      let stage: string | null = local?.stage || null;
      let failReason: string | null = local?.failReason || null;
      let preferredAgentId: string | null = local?.preferredAgentId || null;

      // 로컬에 없지만 IVE 레이블이 붙어있으면 waiting으로 등록
      if (!stage) {
        const issueLabels = issue.labels || [];
        if (issueLabels.includes(project.labelTarget)) {
          stage = 'waiting';
          setIssueStage(projectId, issue.iid, 'waiting', undefined, issue.created_at);
        }
      }

      // 선호 에이전트 정보 조회
      let preferredAgentName: string | null = null;
      let preferredAgentAvatar: string | null = null;
      let preferredAgentCliName: string | null = null;
      if (preferredAgentId) {
        const agent = getAgent(preferredAgentId);
        if (agent) {
          preferredAgentName = agent.name;
          preferredAgentAvatar = agent.avatar;
          preferredAgentCliName = agent.cliName;
        } else {
          preferredAgentId = null;
        }
      }

      // assignees 매핑 (GitLab: assignees[], GitHub: assignees[])
      const assignees = (issue.assignees || []).map((a: any) => ({
        id: a.id,
        username: a.username || a.login,
        name: a.name || a.login || a.username,
        avatarUrl: a.avatar_url,
      }));

      return {
        iid: issue.iid,
        title: issue.title,
        description: issue.description,
        state: issue.state,
        stage: stage || 'none',
        failReason,
        preferredAgentId,
        preferredAgentName,
        preferredAgentAvatar,
        preferredAgentCliName,
        assignees,
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

  const { title, description, asDev, preferredAgentId, assigneeIds, assigneeUsernames } = await req.json();
  if (!title?.trim()) return NextResponse.json({ error: '제목을 입력하세요.' }, { status: 400 });

  try {
    const decryptedToken = decrypt(project.accessToken);
    const labels = asDev ? [project.labelTarget] : [];
    const assignees = (assigneeIds?.length || assigneeUsernames?.length)
      ? { ids: assigneeIds, usernames: assigneeUsernames } : undefined;
    const issue = await createIssue(project, decryptedToken, title.trim(), description?.trim() ?? '', labels, assignees);

    // 이슈 생성 시 로컬 DB에 stage 등록
    if (asDev && issue.iid) {
      setIssueStage(projectId, issue.iid, 'waiting', undefined, issue.created_at);
      // 선호 에이전트 지정
      if (preferredAgentId) {
        setPreferredAgent(projectId, issue.iid, preferredAgentId);
      }
    }

    return NextResponse.json(issue);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '이슈 생성 실패' }, { status: 500 });
  }
}
