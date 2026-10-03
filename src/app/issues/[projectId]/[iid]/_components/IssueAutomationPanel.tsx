'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useToast } from '@/components/ui/Toast'

interface EvidenceRun {
  stage: 'reproduce' | 'verify' | 'confirm'
  stamp: string
  dir: string
  files: string[]
  images: string[]
  result: {
    verdict?: 'pass' | 'fail' | 'blocked'
    summary?: string
    reason?: string
    engines?: { engine: string; status: string; note?: string }[]
    screenshots?: { file: string; caption?: string }[]
    newDefects?: string[]
    findings?: { kind?: 'missing' | 'defect' | null; severity: string; file: string; line: number | null; note: string }[]
    /** 검증 — 이슈에서 뽑은 요건과 구현 여부 */
    requirements?: { item: string; status: 'done' | 'missing'; where: string }[]
    /** 확인 — 확인 항목과 증거 */
    items?: { item: string; how: string; result: 'gone' | 'present' | 'unverified'; evidence: string[] }[]
    checks?: { command: string; ok: boolean; exitCode: number | null; timedOut: boolean; durationSec: number }[]
    behindTarget?: boolean
    conflictFiles?: string[]
    executionId?: string
    agent?: string
  } | null
}

interface RolesInfo {
  workerNote: string | null
  automation: { allowed: boolean; author: string | null; approvedAt: string | null }
  canApprove: boolean
  candidates: Record<'process' | 'verify' | 'confirm', { subjectType: 'user' | 'agent' }[]>
  roles: { confirmer: { mode: string } }
}

/** 증적 폴더 시각(UTC, 2026-10-01T05-07-47-694Z) → 보는 사람 시간대의 「월/일 시:분」 */
function stampLabel(stamp: string): string {
  const m = stamp.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d)-(\d\d)-(\d\d)/)
  if (!m) return stamp
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`)
  if (isNaN(d.getTime())) return stamp
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const VERDICT_BADGE: Record<string, string> = {
  pass: 'bg-ive-cyan/20 text-ive-cyan',
  fail: 'bg-ive-red/20 text-ive-red',
  blocked: 'bg-ive-amber/20 text-ive-amber',
}

/**
 * 이슈 상세 — 단계 자동화 상태와 증적. 이슈 본문과 같은 상자 모양으로, 보일 것이 있을 때만 나온다.
 *   - 단계 작업자가 기동하지 못한 이유, 외부 작성자 이슈의 자동 실행 승인
 *   - 「모든 단계 자동배정」 (명부에 에이전트가 있을 때)
 *   - 단계별 증적(스크린샷·엔진별 결과) + 실행 로그(실행 상세) 링크
 */
export default function IssueAutomationPanel({
  projectId, iid, stage, canEditRoles, onChanged,
}: {
  projectId: string
  iid: string
  stage: string
  canEditRoles: boolean
  onChanged: () => void
}) {
  const t = useTranslations('automation')
  const tc = useTranslations('common')
  const { toast } = useToast()
  const [info, setInfo] = useState<RolesInfo | null>(null)
  const [runs, setRuns] = useState<EvidenceRun[]>([])
  const [busy, setBusy] = useState<null | 'auto_all' | 'approve_automation'>(null)
  const focusRun = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('run') : null

  const load = useCallback(async () => {
    const [r, e] = await Promise.all([
      fetch(`/api/projects/${projectId}/issues/${iid}/roles`).then(x => (x.ok ? x.json() : null)).catch(() => null),
      fetch(`/api/projects/${projectId}/issues/${iid}/evidence`).then(x => (x.ok ? x.json() : null)).catch(() => null),
    ])
    if (r) setInfo(r)
    if (e) setRuns(e.runs || [])
  }, [projectId, iid])

  useEffect(() => { void (async () => { await load() })() }, [load, stage])

  async function post(action: 'auto_all' | 'approve_automation') {
    setBusy(action)
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/roles`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast(d.error || tc('saveFailed'), 'error'); return }
      if (action === 'auto_all') {
        if (d.warnings?.length) toast(d.warnings.join(' / '), 'warning')
        else toast(t('autoAllDone'), 'success')
      } else toast(t('approvedAutomation'), 'success')
      await load()
      onChanged()
    } finally { setBusy(null) }
  }

  const isDone = stage === 'done' || stage === 'closed'
  // 승인은 에이전트가 이 이슈의 단계를 맡을 때만 의미가 있다(지금은 확인자 에이전트)
  const needsApproval = !!info && info.roles.confirmer.mode === 'agent' && !info.automation.allowed && !info.automation.approvedAt
  // 명부에 에이전트가 있을 때만 — 사람(Git 멤버)은 모든 프로젝트 명부에 기본으로 들어 있으므로 세지 않는다
  const hasAgents = !!info && (['process', 'verify', 'confirm'] as const).some(k => info.candidates[k].some(c => c.subjectType === 'agent'))
  const canAutoAll = canEditRoles && !isDone && stage !== 'dev' && hasAgents
  if ((!info?.workerNote || isDone) && !needsApproval && runs.length === 0 && !canAutoAll) return null

  const fileUrl = (run: EvidenceRun, file: string) =>
    `/api/projects/${projectId}/issues/${iid}/evidence/file?run=${encodeURIComponent(run.dir)}&file=${encodeURIComponent(file)}`

  return (
    <div className="mt-1.5 mr-2 text-sm text-ive-text bg-ive-bg-card rounded-lg p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-ive-text-dim uppercase tracking-widest flex-1">
          <i className="fa-solid fa-robot mr-1" />{t('issuePanelTitle')}
        </span>
        {canAutoAll && (
          <button type="button" disabled={!!busy} onClick={() => post('auto_all')}
            className="text-sm font-bold text-ive-cyan border border-ive-cyan/30 px-3 py-1.5 rounded-lg hover:bg-ive-cyan/10 transition-all disabled:opacity-40">
            <i className={`fa-solid ${busy === 'auto_all' ? 'fa-circle-notch fa-spin' : 'fa-wand-magic-sparkles'} mr-1`} />{t('autoAllAgents')}
          </button>
        )}
      </div>

      {info?.workerNote && !isDone && (
        <div className="bg-ive-amber/10 border border-ive-amber/30 rounded-lg px-3 py-2.5 text-xs text-ive-amber leading-relaxed">
          <i className="fa-solid fa-triangle-exclamation mr-1.5" />{info.workerNote}
        </div>
      )}
      {needsApproval && (
        <div className="bg-ive-amber/10 border border-ive-amber/30 rounded-lg px-3 py-2.5 text-xs text-ive-amber leading-relaxed flex items-center gap-2">
          <span className="flex-1"><i className="fa-solid fa-shield-halved mr-1.5" />{t('outsideAllowlist', { author: info?.automation.author || '-' })}</span>
          {info?.canApprove && (
            <button type="button" disabled={!!busy} onClick={() => post('approve_automation')}
              className="text-sm font-bold text-ive-cyan border border-ive-cyan/30 px-3 py-1.5 rounded-lg hover:bg-ive-cyan/10 transition-all disabled:opacity-40 shrink-0">
              <i className={`fa-solid ${busy === 'approve_automation' ? 'fa-circle-notch fa-spin' : 'fa-check'} mr-1`} />{t('approveAutomation')}
            </button>
          )}
        </div>
      )}

      {runs.map(run => {
        const v = run.result?.verdict
        const captions = new Map((run.result?.screenshots || []).map(s => [s.file.replace(/^\.?\/?\.ive-out\//, ''), s.caption || '']))
        return (
          <div key={run.dir} className={`bg-ive-bg-deep rounded-lg px-3 py-2 border space-y-2 ${focusRun === run.dir ? 'border-ive-cyan/40' : 'border-ive-border-dark'}`}>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-bold px-2 py-0.5 rounded-lg bg-ive-cyan/20 text-ive-cyan">{t(`kind_${run.stage}`)}</span>
              {v && <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${VERDICT_BADGE[v]}`}>{t(`verdict_${v}`)}</span>}
              {run.result?.agent && <span className="text-xs text-ive-text-dim"><i className="fa-solid fa-robot mr-1" />{run.result.agent}</span>}
              <span className="text-xs text-ive-text-dim ml-auto">{stampLabel(run.stamp)}</span>
            </div>
            {run.result?.summary && <p className="text-xs text-ive-text whitespace-pre-wrap leading-relaxed">{run.result.summary}</p>}
            {run.result?.reason && v !== 'pass' && <p className="text-xs text-ive-text-muted"><b>{t('reason')}</b>: {run.result.reason}</p>}
            {run.images.length > 0 && (
              // 증적은 버튼·라벨만 잘라 찍은 작은 이미지가 많다 — 칸 폭에 맞춰 키우면 흐릿하게 커진다.
              // 고정 높이 칸 안에 원본 크기 이하로(비율 유지) 보이고, 누르면 원본을 연다
              <div className="grid grid-cols-2 desk:grid-cols-4 gap-2">
                {run.images.map(img => (
                  <a key={img} href={fileUrl(run, img)} target="_blank" rel="noreferrer" className="block min-w-0">
                    <span className="h-36 flex items-center justify-center rounded-lg border border-ive-border-dark bg-ive-bg-deep overflow-hidden p-1">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={fileUrl(run, img)} alt={img} className="max-w-full max-h-full object-contain" />
                    </span>
                    <span className="block text-xs text-ive-text-dim mt-0.5 truncate">{captions.get(img) || img.split('/').pop()}</span>
                  </a>
                ))}
              </div>
            )}
            {(run.result?.engines?.length || 0) > 0 && (
              <div className="flex gap-1 flex-wrap">
                {run.result!.engines!.map((e, i) => (
                  <span key={i} title={e.note || ''} className={`text-xs font-bold px-2 py-0.5 rounded-lg ${e.status === 'pass' ? 'bg-ive-cyan/20 text-ive-cyan' : e.status === 'fail' ? 'bg-ive-red/20 text-ive-red' : 'bg-white/5 text-ive-text-dim'}`}>
                    {e.engine} {e.status}
                  </span>
                ))}
              </div>
            )}
            {(run.result?.checks?.length || 0) > 0 && (
              <div className="flex gap-1 flex-wrap">
                {run.result!.checks!.map((c, i) => (
                  <span key={i} title={`${c.command} · ${c.durationSec}s`} className={`text-xs font-bold px-2 py-0.5 rounded-lg font-mono max-w-full truncate ${c.ok ? 'bg-ive-cyan/20 text-ive-cyan' : 'bg-ive-red/20 text-ive-red'}`}>
                    {c.ok ? '✓' : '✗'} {c.command}
                  </span>
                ))}
              </div>
            )}
            {run.result?.behindTarget && <p className="text-xs text-ive-text-dim"><i className="fa-solid fa-code-branch mr-1" />{t('behindTarget')}</p>}
            {(run.result?.requirements?.length || 0) > 0 && (
              <div className="text-xs text-ive-text-muted">
                <b>{t('requirementsTitle', { done: run.result!.requirements!.filter(q => q.status === 'done').length, n: run.result!.requirements!.length })}</b>
                <ul className="ml-1">
                  {run.result!.requirements!.map((q, i) => (
                    <li key={i}>{q.status === 'done' ? '✅' : '❌'} {q.item}{q.where && <span className="font-mono text-ive-text-dim"> {q.where}</span>}</li>
                  ))}
                </ul>
              </div>
            )}
            {(run.result?.items?.length || 0) > 0 && (
              <div className="text-xs text-ive-text-muted">
                <b>{t('confirmItemsTitle', { done: run.result!.items!.filter(c => c.result === 'gone' && c.evidence?.length).length, n: run.result!.items!.length })}</b>
                <ul className="ml-1">
                  {run.result!.items!.map((c, i) => (
                    <li key={i}>
                      {c.result === 'gone' ? '✅' : c.result === 'present' ? '❌' : '⚠️'} {c.item}
                      {c.how && <span className="text-ive-text-dim"> — {c.how}</span>}
                      {c.evidence?.length > 0 && <span className="font-mono text-ive-text-dim"> ({c.evidence.join(', ')})</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(run.result?.findings?.length || 0) > 0 && (
              <div className="text-xs text-ive-text-muted">
                <b>{t('findings')}</b>
                <ul className="list-disc ml-4">
                  {run.result!.findings!.map((f, i) => (
                    <li key={i}>
                      <span className="font-bold">[{f.kind === 'missing' ? t('findingMissing') : f.kind === 'defect' ? t('findingDefect') : f.severity}]</span>
                      {f.file && <span className="font-mono text-ive-text-dim"> {f.file}{f.line ? `:${f.line}` : ''}</span>} {f.note}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(run.result?.newDefects?.length || 0) > 0 && (
              <div className="text-xs text-ive-text-muted">
                <b>{t('newDefects')}</b>
                <ul className="list-disc ml-4">{run.result!.newDefects!.map((d, i) => <li key={i}>{d}</li>)}</ul>
              </div>
            )}
            {run.result?.executionId && (
              <Link href={`/executions/${run.result.executionId}`} className="inline-block text-xs font-bold text-ive-cyan hover:opacity-80">
                <i className="fa-solid fa-terminal mr-1" />{t('viewRunLog')}
              </Link>
            )}
          </div>
        )
      })}
    </div>
  )
}
