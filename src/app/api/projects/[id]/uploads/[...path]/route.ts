import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAccess, getProjectAuthToken } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { getApiBaseUrl, getProjectPath, getAuthHeaders } from '@/lib/gitlab';

/**
 * GitLab 업로드 이미지 프록시.
 * GitLab의 /uploads/ 경로는 인증이 필요하므로 IVE 서버가 토큰을 붙여 대신 가져온다.
 * GET /api/projects/:id/uploads/:hash/:filename
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; path: string[] }> },
) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse(null, { status: 401 });

  const { id: projectId, path: segments } = await params;
  const project = getProject(projectId);
  if (!project) return new NextResponse(null, { status: 404 });

  if (!getProjectAccess(projectId, user.id)) {
    return new NextResponse(null, { status: 403 });
  }

  if (project.provider !== 'gitlab') {
    return new NextResponse(null, { status: 404 });
  }

  const uploadPath = `/uploads/${segments.join('/')}`;
  const token = getProjectAuthToken(projectId);
  if (!token) return new NextResponse(null, { status: 403 });

  try {
    const apiBase = getApiBaseUrl(project.repoUrl);
    const projectPath = getProjectPath(project.repoUrl);
    const url = `${apiBase}/projects/${projectPath}${uploadPath}`;
    const headers = getAuthHeaders(project, token);

    const res = await fetch(url, { headers, redirect: 'follow' });
    if (!res.ok) return new NextResponse(null, { status: res.status });

    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    const body = await res.arrayBuffer();

    return new NextResponse(body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
