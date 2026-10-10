import { NextRequest, NextResponse } from 'next/server'
import { getProject, getProjectAuthToken } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { decrypt } from '@/lib/crypto'
import { deleteIssueComment } from '@/lib/provider'
import { getUserOAuthTokenRaw, getOAuthProviderById } from '@/lib/db'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string; noteId: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId, iid, noteId } = await params
  const project = getProject(projectId)
  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다. 삭제되었을 수 있습니다 — 새로고침해 주세요.' }, { status: 404 })

  try {
    // 1. OAuth 토큰 시도 (본인인지 확인하는 겸 가장 확실한 방법)
    let tokenToUse: string | null = null
    let usingUserToken = false

    if (user.oauthProviderId && user.oauthUserId) {
      const provider = getOAuthProviderById(user.oauthProviderId)
      if (provider && provider.type === project.provider) {
        const raw = getUserOAuthTokenRaw(user.id)
        if (raw?.encrypted) {
          tokenToUse = decrypt(raw.encrypted)
          usingUserToken = true
        }
      }
    }

    // 2. 관리자이거나 프로젝트 소유자라면 프로젝트 토큰으로라도 삭제 가능케 함
    // (보통 GitLab/GitHub API는 관리자 토큰이면 다른 사람의 코멘트도 삭제 가능)
    if (!tokenToUse) {
      tokenToUse = getProjectAuthToken(projectId)
    }

    await deleteIssueComment(project, Number(iid), Number(noteId), tokenToUse, { isOAuth: usingUserToken })

    logActivity({
      userId: user.id,
      category: 'task',
      action: 'delete_note',
      detail: `이슈 코멘트 삭제: ${project.name} #${iid} (note ${noteId})`,
      targetType: 'issue_note',
      targetId: `${projectId}:${iid}:${noteId}`,
      req,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error(`[notes DELETE] Failed to delete note ${noteId}:`, err)
    return NextResponse.json({ error: '코멘트 삭제 실패' }, { status: 500 })
  }
}
