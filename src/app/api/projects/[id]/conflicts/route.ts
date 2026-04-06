import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getProject, getProjectAccess, updateProjectConflictCount, markIssueVerified, touchProjectActivity } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { fetchOpenMRs, mergeMR, closeMR, fetchSingleIssue, addIssueLabels, removeIssueLabels } from '@/lib/provider'
import { logActivity } from '@/lib/activity'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const project = getProject(id)
  if (!project || !getProjectAccess(id, user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let decryptedToken: string
  try {
    decryptedToken = decrypt(project.accessToken)
  } catch {
    return NextResponse.json({ error: 'Token decryption failed' }, { status: 500 })
  }

  const openMRs = await fetchOpenMRs(project, decryptedToken)
  const conflicts = openMRs.filter((mr: any) => mr.has_conflicts)

  // DB 캐시도 실시간 값으로 동기화 — 카드 통계에 반영
  updateProjectConflictCount(id, conflicts.length)

  return NextResponse.json({
    conflictCount: conflicts.length,
    totalOpenMRs: openMRs.length,
    conflicts,
    all: openMRs,
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const project = getProject(id)
  if (!project || !getProjectAccess(id, user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let decryptedToken: string
  try {
    decryptedToken = decrypt(project.accessToken)
  } catch {
    return NextResponse.json({ error: 'Token decryption failed' }, { status: 500 })
  }

  const body = await req.json()
  const { action, mrIids } = body

  if (!Array.isArray(mrIids)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  if (action === 'sequential_merge') {
    // 머지 전 열린 MR 목록을 가져와서 MR IID → 이슈 IID 매핑 구성
    const openMRs = await fetchOpenMRs(project, decryptedToken)
    const mrToIssue = new Map<number, number>()
    for (const mr of openMRs) {
      const match = mr.source_branch?.match(/^dev-(\d+)$/)
      if (match) {
        mrToIssue.set(mr.iid, Number(match[1]))
      }
    }

    const results: { iid: number; success: boolean; error?: string }[] = []
    for (const iid of mrIids) {
      try {
        await mergeMR(project, decryptedToken, iid)
        results.push({ iid, success: true })
      } catch (e) {
        results.push({ iid, success: false, error: e instanceof Error ? e.message : String(e) })
      }
    }

    // 머지 성공한 MR에 대해 관련 이슈의 IVE-V → IVE-E 레이블 전환
    const labelV = project.labelVerify || 'IVE-V'
    const labelE = project.labelEnd || 'IVE-E'

    for (const r of results) {
      if (!r.success) continue
      const issueIid = mrToIssue.get(r.iid)
      if (!issueIid) continue

      try {
        const issue = await fetchSingleIssue(project, issueIid, decryptedToken)
        if (!issue) continue

        const labels: string[] = issue.labels || []
        if (labels.includes(labelV) && !labels.includes(labelE)) {
          await removeIssueLabels(project, issueIid, decryptedToken, [labelV])
          await addIssueLabels(project, issueIid, decryptedToken, [labelE])
          markIssueVerified(id, issueIid)
          touchProjectActivity(id)

          if (user) {
            logActivity({
              userId: user.id,
              category: 'task',
              action: 'task_complete',
              detail: `머지 완료 → 자동 전환 (이슈 #${issueIid}, ${project.name})`,
              targetType: 'issue',
              targetId: `${id}:${issueIid}`,
              req,
            })
          }
        }
      } catch (err) {
        console.error(`[Conflicts] 이슈 #${issueIid} 레이블 전환 실패:`, err)
      }
    }

    return NextResponse.json({
      results,
      mergedCount: results.filter(r => r.success).length,
      failedCount: results.filter(r => !r.success).length,
    })
  }

  if (action === 'close') {
    const results: { iid: number; success: boolean; error?: string }[] = []
    for (const iid of mrIids) {
      try {
        await closeMR(project, decryptedToken, iid)
        results.push({ iid, success: true })
      } catch (e) {
        results.push({ iid, success: false, error: e instanceof Error ? e.message : String(e) })
      }
    }
    return NextResponse.json({
      results,
      closedCount: results.filter(r => r.success).length,
      failedCount: results.filter(r => !r.success).length,
    })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
