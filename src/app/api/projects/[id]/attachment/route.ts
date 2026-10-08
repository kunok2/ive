import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAccess, getProjectAuthToken } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { downloadGitHubFile } from '@/lib/github';
import { isGitHubAttachmentUrl } from '@/lib/github-attachment';

/**
 * GitHub 이슈 첨부 이미지 프록시.
 * private 저장소의 첨부(github.com/user-attachments/assets/…, raw.githubusercontent.com/…)는
 * 로그인 쿠키 없이는 404 라 브라우저가 못 연다 — IVE 서버가 프로젝트 토큰을 붙여 대신 가져온다.
 * (GitLab /uploads/ 는 ../uploads/[...path] 가 맡는다)
 * GET /api/projects/:id/attachment?url=<encoded GitHub URL>
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse(null, { status: 401 });

  const { id: projectId } = await params;
  const project = getProject(projectId);
  if (!project) return new NextResponse(null, { status: 404 });

  if (!getProjectAccess(projectId, user.id)) {
    return new NextResponse(null, { status: 403 });
  }

  const url = req.nextUrl.searchParams.get('url') || '';
  // GitHub 호스트가 아니면 거절 — 임의 URL 로 토큰을 보내는 프록시가 되지 않게
  if (project.provider !== 'github' || !isGitHubAttachmentUrl(url)) {
    return new NextResponse(null, { status: 400 });
  }

  const token = getProjectAuthToken(projectId);
  if (!token) return new NextResponse(null, { status: 403 });

  try {
    const file = await downloadGitHubFile(project, token, url);
    if (!file) return new NextResponse(null, { status: 404 });
    // 이미지만 — IVE 출처로 HTML/SVG 를 내보내면 스크립트가 IVE 권한으로 돈다
    const type = file.contentType.split(';')[0].trim().toLowerCase();
    if (!type.startsWith('image/') || type === 'image/svg+xml') {
      return new NextResponse(null, { status: 415 });
    }
    return new NextResponse(new Uint8Array(file.buffer), {
      headers: {
        'Content-Type': type,
        'X-Content-Type-Options': 'nosniff',
        // 권한 확인을 거친 비공개 첨부 — 공유 캐시에 남기지 않는다
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
