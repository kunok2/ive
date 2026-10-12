import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getProject, getProjectAuthToken, getProjectAccess, updateProjectConflictCount, markIssueVerified, touchProjectActivity, getDb, updateExecutionStatus, upsertIssueStageSnapshot, recordStageEvent } from '@/lib/db'
import { userActor } from '@/lib/event-actor'
import { iveMrLabel, fetchOpenMRs, mergeMR, closeMR, fetchSingleIssue, addIssueLabels, removeIssueLabels, swapIssueLabels } from '@/lib/provider'
import { logActivity } from '@/lib/activity'
import { DEFAULT_LABELS } from '@/lib/labels'

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
    decryptedToken = getProjectAuthToken(id)
  } catch {
    return NextResponse.json({ error: 'Token decryption failed' }, { status: 500 })
  }

  // IVE 가 만든(표시 레이블이 달린) MR/PR 만 — 저장소의 다른 MR 은 카드에 세지 않는다
  const iveLabel = iveMrLabel(project)
  const openMRs = (await fetchOpenMRs(project, decryptedToken)).filter((mr: any) => mr.labels?.includes(iveLabel))
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
    decryptedToken = getProjectAuthToken(id)
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

    // 머지 성공한 MR에 대해 관련 이슈의 IVE 레이블 → IVE-E 전환 + 실행 기록 정리
    const labelD = project.labelDev || DEFAULT_LABELS.dev
    const labelW = project.labelVerifyWait || DEFAULT_LABELS.verifyWait
    const labelV = project.labelVerify || DEFAULT_LABELS.verify
    const labelE = project.labelEnd || DEFAULT_LABELS.end
    const db = getDb()

    for (const r of results) {
      if (!r.success) continue
      const issueIid = mrToIssue.get(r.iid)
      if (!issueIid) continue

      try {
        const issue = await fetchSingleIssue(project, issueIid, decryptedToken)
        if (!issue) continue

        const labels: string[] = issue.labels || []
        if (!labels.includes(labelE)) {
          const labelsToRemove = [labelD, labelW, labelV].filter(l => labels.includes(l))
          await swapIssueLabels(project, issueIid, decryptedToken, [labelE], labelsToRemove)
        }

        // 활성 실행(running/assigned) 모두 success로 닫기
        const activeExecs = db.prepare(
          "SELECT id FROM task_executions WHERE project_id = ? AND issue_iid = ? AND status IN ('running', 'assigned')"
        ).all(id, issueIid) as { id: string }[]
        for (const ex of activeExecs) {
          updateExecutionStatus(ex.id, 'success', new Date().toISOString())
        }

        // issue_stages.cached_stage를 즉시 'done'으로 업데이트 (스캐너 대기 없이 반영)
        const stageRow = db.prepare(
          'SELECT cached_stage, assignee_username, assignee_name, assignee_avatar, assignee_provider, assignee_git_user_id, issue_title FROM issue_stages WHERE project_id = ? AND issue_iid = ?'
        ).get(id, issueIid) as any
        if (stageRow) {
          // 사건 로그 — 일괄 병합으로 완료 처리
          recordStageEvent({
            projectId: id, issueIid, fromStage: stageRow.cached_stage, toStage: 'done', action: 'bulk_merge',
            actor: userActor(user), source: 'ui',
          })
          upsertIssueStageSnapshot(id, issueIid, {
            cachedStage: 'done',
            assigneeUsername: stageRow.assignee_username,
            assigneeName: stageRow.assignee_name,
            assigneeAvatar: stageRow.assignee_avatar,
            assigneeProvider: stageRow.assignee_provider,
            assigneeGitUserId: stageRow.assignee_git_user_id,
            issueTitle: stageRow.issue_title,
          })
        }

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
