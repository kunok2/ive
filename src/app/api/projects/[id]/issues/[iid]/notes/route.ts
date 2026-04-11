import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAccess, getUserById, getUserOAuthTokenRaw, getOAuthProviderById } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { decrypt } from '@/lib/crypto';
import { fetchIssueNotes, addIssueComment } from '@/lib/provider';
import type { User } from '@/types';

// IVE 사용자가 작성한 노트임을 표시하는 마커 (Git에는 숨겨진 HTML 주석으로 저장)
const IVE_AUTHOR_MARKER_RE = /<!--\s*ive-author:([a-zA-Z0-9_-]+)\s*-->/;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: projectId, iid } = await params;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  if (!getProjectAccess(projectId, user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const decryptedToken = decrypt(project.accessToken);
    const notes = await fetchIssueNotes(project, Number(iid), decryptedToken);

    // IVE 사용자 조회 캐시 (여러 노트가 같은 사용자일 때 중복 조회 방지)
    const iveUserCache = new Map<string, User | null>();
    const resolveIveUser = (id: string): User | null => {
      if (!iveUserCache.has(id)) {
        iveUserCache.set(id, getUserById(id));
      }
      return iveUserCache.get(id) || null;
    };

    const mapped = (notes as any[]).map((n: any) => {
      let author = n.author?.name;
      let avatarUrl = n.author?.avatar_url || '';
      let iveAuthorAvatar: string | null = null;

      // IVE 마커가 있으면 원래 작성한 IVE 사용자 정보로 override
      const match: RegExpMatchArray | null = typeof n.body === 'string' ? n.body.match(IVE_AUTHOR_MARKER_RE) : null;
      if (match) {
        const iveUser = resolveIveUser(match[1]);
        if (iveUser) {
          author = iveUser.name;
          iveAuthorAvatar = iveUser.avatar === 'photo'
            ? `/api/auth/avatar/image?id=${iveUser.id}`
            : iveUser.avatar;
          avatarUrl = '';
        }
      }

      return {
        id: n.id,
        body: n.body,
        author,
        avatarUrl,
        iveAuthorAvatar,
        system: n.system,
        createdAt: n.created_at,
      };
    });

    return NextResponse.json(mapped);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '노트 조회 실패' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: projectId, iid } = await params;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const access = getProjectAccess(projectId, user.id);
  if (!access || access === 'viewer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { body } = await req.json();
  if (!body?.trim()) return NextResponse.json({ error: '내용을 입력하세요.' }, { status: 400 });

  try {
    // 토큰 선택 우선순위:
    //   1) 로그인 유저가 OAuth로 접속했고 provider 타입이 프로젝트와 일치하면 → 유저 OAuth 토큰 사용
    //      → Git 측 노트 작성자가 실제 유저로 표시됨 (프로젝트 공용 토큰이 아님)
    //   2) 그 외(로컬 유저, OAuth 토큰 없음, provider 불일치) → 프로젝트 토큰 fallback
    let tokenToUse: string | null = null
    let usingUserToken = false
    if (user.oauthProviderId && user.oauthUserId) {
      const provider = getOAuthProviderById(user.oauthProviderId)
      if (provider && provider.type === project.provider) {
        const raw = getUserOAuthTokenRaw(user.id)
        if (raw?.encrypted) {
          try {
            tokenToUse = decrypt(raw.encrypted)
            usingUserToken = true
          } catch (e) {
            console.warn('[notes POST] OAuth token decrypt failed, falling back to project token:', e)
          }
        }
      }
    }
    if (!tokenToUse) {
      tokenToUse = decrypt(project.accessToken);
    }

    // IVE 사용자 식별 마커 — 프로젝트 토큰 사용 시 필수 (작성자 복원용),
    // 유저 토큰 사용 시는 Git에 이미 실제 author가 남으므로 생략
    const finalBody = usingUserToken
      ? body.trim()
      : `<!-- ive-author:${user.id} -->\n${body.trim()}`;

    try {
      await addIssueComment(project, Number(iid), tokenToUse, finalBody);
    } catch (err) {
      // 유저 토큰으로 실패하면 프로젝트 토큰으로 한 번 더 시도 (토큰 만료/권한 부족 대응)
      if (usingUserToken) {
        console.warn('[notes POST] user OAuth token failed, retrying with project token:', err)
        const projectToken = decrypt(project.accessToken);
        const fallbackBody = `<!-- ive-author:${user.id} -->\n${body.trim()}`;
        await addIssueComment(project, Number(iid), projectToken, fallbackBody);
      } else {
        throw err;
      }
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '코멘트 추가 실패' }, { status: 500 });
  }
}
