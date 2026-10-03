'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import CustomSelect from '@/components/ui/CustomSelect'
import { INPUT_CLS, ROW_CLS, SaveIndicator, Segmented, Stepper, Switch, useAutosave } from './shared'

type RoleKey = 'process' | 'verify' | 'confirm'

interface RosterEntry { subjectType: 'user' | 'agent'; subjectId: string; name: string; avatar?: string; roles: Record<RoleKey, boolean> }
interface PresetRole { mode: 'creator' | 'auto' | 'specific' | 'agent'; agentId?: string | null; userId?: string | null; username?: string | null }
interface RoleDefaults {
  autoAllAgents: boolean
  processor?: { mode: 'auto' | 'assignee' | 'agent'; agentId?: string | null } | null
  verifier?: PresetRole | null
  confirmer?: PresetRole | null
}
/** 기본 배정 — 본 값은 「IVE 에서 등록」, intake 는 「작업 접수 페이지·API·Git 직접」(없으면 같게) */
interface DefaultRoles extends RoleDefaults {
  intake?: RoleDefaults | null
  intakeAutoRun?: boolean
}
interface Limits {
  verifyMaxConcurrent: number; verifyMaxTurns: number; verifyTimeoutMin: number
  confirmMaxConcurrent: number; confirmMaxTurns: number; confirmTimeoutMin: number; maxAutoCycles: number
}
interface StagingSettings { url: string; versionSource: 'url' | 'pipeline'; versionUrl: string; commitField: string; branch: string; notes: string }
interface MergeSettings { agentMerge: boolean; checkCommands: string; checkTimeoutMin: number }
interface AutomationData {
  canEdit: boolean
  /** staging 정보·비밀값은 소유자(관리자)만 */
  canEditStaging: boolean
  staging: StagingSettings
  merge: MergeSettings
  closeIssueOnMerge: boolean
  defaultRoles: DefaultRoles
  authorAllowlist: string[]
  stagingSecretNames: string[]
  limits: Limits
  autoAllPreview: { processor: string | null; verifier: string | null; confirmer: string | null; warnings: string[] }
}

const LIMIT_RANGE: Record<keyof Limits, [number, number]> = {
  verifyMaxConcurrent: [1, 10],
  verifyMaxTurns: [10, 300],
  verifyTimeoutMin: [5, 120],
  confirmMaxConcurrent: [1, 10],
  confirmMaxTurns: [10, 300],
  confirmTimeoutMin: [5, 120],
  maxAutoCycles: [1, 10],
}

/** 프로젝트 설정 <form> 안이므로 Enter 가 프로젝트 저장(submit)으로 새지 않게 막는다 */
const noSubmit = (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLElement).blur() } }
const SUB_LABEL = 'block text-sm font-bold text-ive-text-muted mb-1.5 ml-1'
const OUTLINE_BTN = 'text-sm font-bold text-ive-cyan border border-ive-cyan/30 px-3 py-1.5 rounded-lg hover:bg-ive-cyan/10 transition-all disabled:opacity-40 shrink-0'

/** 기본 배정·작성자 허용 목록·staging 비밀값·상한 — 바꾸면 바로 저장 */
export default function AutomationPanel({ projectId }: { projectId: string }) {
  const t = useTranslations('automation')
  const tc = useTranslations('common')
  const [data, setData] = useState<AutomationData | null>(null)
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [agentRoles, setAgentRoles] = useState<Record<RoleKey, boolean>>({ process: true, verify: true, confirm: true })
  const [allowInput, setAllowInput] = useState('')
  const [secretName, setSecretName] = useState('')
  const [secretValue, setSecretValue] = useState('')
  const [changing, setChanging] = useState<Record<string, string>>({})
  // staging 칸 편집값 — 칸을 벗어나면 저장 (관리자 설정과 같은 blur 저장)
  const [stDraft, setStDraft] = useState<Partial<StagingSettings>>({})
  // 기본 배정을 고치는 경로 — IVE 에서 등록 / 작업 접수 페이지·API·Git 직접
  const [channel, setChannel] = useState<'ive' | 'intake'>('ive')
  // 검사 명령 칸 편집값 — 칸을 벗어나면 저장
  const [bDraft, setBDraft] = useState<Partial<Pick<MergeSettings, 'checkCommands'>>>({})
  const { saving, saved, run } = useAutosave()

  const load = useCallback(async () => {
    const [a, r] = await Promise.all([
      fetch(`/api/projects/${projectId}/automation`).then(x => (x.ok ? x.json() : null)),
      fetch(`/api/projects/${projectId}/roles`).then(x => (x.ok ? x.json() : null)),
    ])
    if (a) setData(a)
    if (r) { setRoster(r.roster); if (r.agentRoles) setAgentRoles(r.agentRoles) }
  }, [projectId])

  useEffect(() => { void (async () => { await load() })() }, [load])

  async function put(patch: Record<string, unknown>): Promise<boolean> {
    const d = await run(() => fetch(`/api/projects/${projectId}/automation`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    }))
    if (d) setData(d as AutomationData)
    return !!d
  }

  if (!data) return <div className="text-center py-10 text-ive-text-dim text-sm">{tc('loading')}</div>

  const disabled = !data.canEdit
  const stagingDisabled = !data.canEditStaging
  const agentOptions = (role: RoleKey) => roster
    .filter(r => agentRoles[role] && r.subjectType === 'agent' && r.roles[role])
    .map(a => ({ value: `agent:${a.subjectId}`, label: a.name, avatar: a.avatar || 'av-01' }))
  const nameOf = (id: string | null) => (id ? roster.find(r => r.subjectType === 'agent' && r.subjectId === id)?.name || id : '-')
  const all = data.defaultRoles
  const baseRoles: RoleDefaults = { autoAllAgents: all.autoAllAgents, processor: all.processor, verifier: all.verifier, confirmer: all.confirmer }
  // 접수 경로가 따로 정해지지 않았으면 IVE 등록과 같은 값을 보여 주고 고칠 수 없다(「IVE 등록과 같게」를 끄면 따로 정한다)
  const sameAsIve = channel === 'intake' && !all.intake
  const d: RoleDefaults = channel === 'ive' ? baseRoles : (all.intake ?? baseRoles)
  const rolesDisabled = disabled || sameAsIve
  const setRoles = (next: Partial<RoleDefaults>) => put({
    defaultRoles: channel === 'ive' ? { ...all, ...next } : { ...all, intake: { ...(all.intake ?? baseRoles), ...next } },
  })
  const processorValue = d.processor?.mode === 'agent' ? `agent:${d.processor.agentId}` : (d.processor?.mode || 'auto')
  const presetValue = (r?: PresetRole | null) => (r?.mode === 'agent' ? `agent:${r.agentId}` : (r?.mode || 'creator'))
  const toPreset = (v: string): PresetRole => (v.startsWith('agent:') ? { mode: 'agent', agentId: v.slice(6) } : { mode: v as PresetRole['mode'] })
  const stValue = (k: keyof StagingSettings) => stDraft[k] ?? data.staging[k] ?? ''
  const stCommit = async (k: keyof StagingSettings) => {
    const v = stDraft[k]
    if (v === undefined || v === data.staging[k]) { setStDraft(x => { const y = { ...x }; delete y[k]; return y }); return }
    if (await put({ staging: { [k]: v } })) setStDraft(x => { const y = { ...x }; delete y[k]; return y })
  }
  const bValue = (k: 'checkCommands') => bDraft[k] ?? data.merge[k] ?? ''
  const bCommit = async (k: 'checkCommands') => {
    const v = bDraft[k]
    const clear = () => setBDraft(x => { const y = { ...x }; delete y[k]; return y })
    if (v === undefined || v === data.merge[k]) { clear(); return }
    if (await put({ merge: { [k]: v } })) clear()
  }
  const addAllow = () => {
    const names = allowInput.split(/[\s,]+/).map(s => s.replace(/^@/, '').trim()).filter(Boolean)
    if (!names.length) return
    void put({ authorAllowlist: Array.from(new Set([...data.authorAllowlist, ...names])) }).then(ok => { if (ok) setAllowInput('') })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ive-text-dim"><i className="fa-solid fa-info-circle mr-1" />{t('automationHint')}</p>
        <SaveIndicator saving={saving} saved={saved} />
      </div>

      {/* 기본 배정 — 들어온 경로별(IVE 등록 / 접수 페이지·API·Git 직접). 「도구 사용 표시」와 같은 스위치 줄 */}
      <div className="space-y-3">
        <label className={SUB_LABEL}><i className="fa-solid fa-user-tag mr-1.5 text-xs" />{t('defaultRoles')}</label>
        <Segmented
          value={channel}
          onChange={setChannel}
          items={[
            { value: 'ive', label: t('channel_ive'), icon: 'fa-pen-to-square' },
            { value: 'intake', label: t('channel_intake'), icon: 'fa-inbox' },
          ]}
        />
        <p className="text-xs text-ive-text-dim ml-1">{t(channel === 'ive' ? 'channelIveHint' : 'channelIntakeHint')}</p>
        {channel === 'intake' && (
          <div className="space-y-3">
            <div>
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-base font-bold text-ive-text-muted"><i className="fa-solid fa-equals mr-1.5 text-sm" />{t('intakeSameAsIve')}</span>
                <Switch on={!all.intake} disabled={disabled} onClick={() => put({ defaultRoles: { ...all, intake: all.intake ? null : baseRoles } })} />
              </label>
            </div>
            <div>
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-base font-bold text-ive-text-muted"><i className="fa-solid fa-shield-halved mr-1.5 text-sm" />{t('intakeAutoRun')}</span>
                <Switch on={!!all.intakeAutoRun} disabled={stagingDisabled} onClick={() => put({ defaultRoles: { ...all, intakeAutoRun: !all.intakeAutoRun } })} />
              </label>
              <p className="text-xs text-ive-text-dim mt-1 ml-6">{t('intakeAutoRunHint')}</p>
            </div>
          </div>
        )}
        <div>
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-base font-bold text-ive-text-muted">
              <i className="fa-solid fa-wand-magic-sparkles mr-1.5 text-sm" />{t('autoAllAgents')}
            </span>
            <Switch on={d.autoAllAgents} disabled={rolesDisabled} onClick={() => setRoles({ autoAllAgents: !d.autoAllAgents })} />
          </label>
          <p className="text-xs text-ive-text-dim mt-1 ml-6">{t('autoAllAgentsHint')}</p>
        </div>

        {d.autoAllAgents ? (
          <div className="space-y-1 ml-6">
            <p className="text-xs text-ive-text-muted">
              {t('autoAllPreview')}: {t('role_process')} <b className="text-ive-text">{nameOf(data.autoAllPreview.processor)}</b> · {t('role_verify')} <b className="text-ive-text">{nameOf(data.autoAllPreview.verifier)}</b> · {t('role_confirm')} <b className="text-ive-text">{nameOf(data.autoAllPreview.confirmer)}</b>
            </p>
            {data.autoAllPreview.warnings.map((w, i) => (
              <p key={i} className="text-xs text-ive-amber"><i className="fa-solid fa-triangle-exclamation mr-1" />{w}</p>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className={SUB_LABEL}>{t('defaultRoles')} · {t('role_process')}</label>
              <CustomSelect
                disabled={rolesDisabled}
                value={processorValue}
                onChange={v => setRoles({ processor: v.startsWith('agent:') ? { mode: 'agent', agentId: v.slice(6) } : { mode: v as 'auto' | 'assignee' } })}
                options={[
                  { value: 'auto', label: t('processorAuto'), icon: 'fa-solid fa-shuffle' },
                  { value: 'assignee', label: t('processorAssignee'), icon: 'fa-solid fa-user' },
                  ...agentOptions('process'),
                ]}
              />
            </div>
            {(['verifier', 'confirmer'] as const).map(role => (
              <div key={role}>
                <label className={SUB_LABEL}>{t('defaultRoles')} · {t(role === 'verifier' ? 'role_verify' : 'role_confirm')}</label>
                <CustomSelect
                  disabled={rolesDisabled}
                  value={presetValue(d[role])}
                  onChange={v => setRoles({ [role]: toPreset(v) })}
                  options={[
                    { value: 'creator', label: t('presetCreator'), icon: 'fa-solid fa-user-plus' },
                    { value: 'auto', label: t('presetAuto'), icon: 'fa-solid fa-shuffle' },
                    ...agentOptions(role === 'verifier' ? 'verify' : 'confirm'),
                  ]}
                />
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-ive-text-dim"><i className="fa-solid fa-info-circle mr-1" />{t('defaultRolesHint')}</p>
      </div>

      {/* staging — 확인(④) 단계가 화면을 열고 배포 커밋을 확인하는 곳. IVE 설정에 둔다 */}
      <div className="border-t border-ive-border-dark pt-3 space-y-3">
        <label className={SUB_LABEL}><i className="fa-solid fa-flask mr-1.5 text-xs" />{t('staging')}</label>
        <div>
          <label className={SUB_LABEL}>{t('stagingVersionSource')}</label>
          {stagingDisabled ? (
            <p className="text-sm text-ive-text ml-1">{t(`versionSource_${data.staging.versionSource || 'url'}`)}</p>
          ) : (
            <Segmented
              value={data.staging.versionSource || 'url'}
              onChange={v => put({ staging: { versionSource: v } })}
              items={[
                { value: 'url', label: t('versionSource_url'), icon: 'fa-link' },
                { value: 'pipeline', label: t('versionSource_pipeline'), icon: 'fa-code-branch' },
              ]}
            />
          )}
          {data.staging.versionSource === 'pipeline' && <p className="text-xs text-ive-text-dim mt-1 ml-1">{t('versionSourcePipelineHint')}</p>}
        </div>
        {([
          { k: 'url', label: t('stagingUrl'), ph: 'https://staging.example.com', mono: false },
          ...(data.staging.versionSource === 'pipeline' ? [] : [
            { k: 'versionUrl', label: t('stagingVersionUrl'), ph: 'https://staging.example.com/version.json', mono: false },
            { k: 'commitField', label: t('stagingCommitField'), ph: 'commit', mono: true },
          ]),
          { k: 'branch', label: t('stagingBranch'), ph: 'staging', mono: true },
        ] as { k: keyof StagingSettings; label: string; ph: string; mono: boolean }[]).map(f => (
          <div key={f.k}>
            <label className={SUB_LABEL}>{f.label}</label>
            <input
              disabled={stagingDisabled} value={stValue(f.k)} placeholder={f.ph}
              onChange={e => setStDraft(x => ({ ...x, [f.k]: e.target.value }))}
              onBlur={() => stCommit(f.k)} onKeyDown={noSubmit}
              className={`${INPUT_CLS}${f.mono ? ' font-mono' : ''}`}
            />
          </div>
        ))}
        <div>
          <label className={SUB_LABEL}>{t('stagingNotes')}</label>
          <textarea
            disabled={stagingDisabled} rows={3} value={stValue('notes')} placeholder={t('stagingNotesPlaceholder')}
            onChange={e => setStDraft(x => ({ ...x, notes: e.target.value }))}
            onBlur={() => stCommit('notes')}
            className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green/50 resize-y"
          />
        </div>
        <p className="text-xs text-ive-text-dim"><i className="fa-solid fa-info-circle mr-1" />{t('stagingHint')}</p>
        {stagingDisabled && <p className="text-xs text-ive-text-dim"><i className="fa-solid fa-lock mr-1" />{t('stagingOwnerOnly')}</p>}
      </div>

      {/* MR 머지로 이슈 자동 닫기 — 처리(D) 커밋·MR 문구의 Git 닫기 키워드 */}
      <div className="border-t border-ive-border-dark pt-3">
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-base font-bold text-ive-text-muted">
            <i className="fa-solid fa-code-merge mr-1.5 text-sm" />{t('closeIssueOnMerge')}
          </span>
          <Switch on={data.closeIssueOnMerge} disabled={disabled} onClick={() => put({ closeIssueOnMerge: !data.closeIssueOnMerge })} />
        </label>
        <p className="text-xs text-ive-text-dim mt-1 ml-6">{t('closeIssueOnMergeHint')}</p>
      </div>

      {/* 머지·검사 — 검증 통과 즉시 MR 머지 여부와 검증 때 돌릴 검사 명령 */}
      <div className="border-t border-ive-border-dark pt-3 space-y-3">
        <label className={SUB_LABEL}><i className="fa-solid fa-code-branch mr-1.5 text-xs" />{t('mergeSettings')}</label>
        <div>
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-base font-bold text-ive-text-muted">
              <i className="fa-solid fa-code-merge mr-1.5 text-sm" />{t('mergeAgentMerge')}
            </span>
            <Switch on={data.merge.agentMerge} disabled={stagingDisabled} onClick={() => put({ merge: { agentMerge: !data.merge.agentMerge } })} />
          </label>
          <p className="text-xs text-ive-text-dim mt-1 ml-6">{t('mergeAgentMergeHint')}</p>
        </div>
        <div>
          <label className={SUB_LABEL}>{t('mergeCheckCommands')}</label>
          <textarea
            disabled={stagingDisabled} rows={4} value={bValue('checkCommands')} placeholder={t('mergeCheckCommandsPlaceholder')}
            onChange={e => setBDraft(x => ({ ...x, checkCommands: e.target.value }))}
            onBlur={() => bCommit('checkCommands')}
            className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green/50 font-mono resize-y"
          />
          <p className="text-xs text-ive-text-dim mt-1 ml-1">{t('mergeCheckCommandsHint')}</p>
        </div>
        <div>
          <label className={SUB_LABEL}>{t('mergeCheckTimeoutMin')}</label>
          <Stepper value={data.merge.checkTimeoutMin} min={1} max={120} disabled={disabled || saving} onChange={v => put({ merge: { checkTimeoutMin: v } })} />
        </div>
        {stagingDisabled && <p className="text-xs text-ive-text-dim"><i className="fa-solid fa-lock mr-1" />{t('mergeOwnerOnly')}</p>}
      </div>

      {/* 작성자 허용 목록 — SharingSection 의 목록 줄 + 추가 */}
      <div className="border-t border-ive-border-dark pt-3 space-y-2">
        <label className={SUB_LABEL}><i className="fa-solid fa-shield-halved mr-1.5 text-xs" />{t('authorAllowlist')}</label>
        {data.authorAllowlist.map(name => (
          <div key={name} className={ROW_CLS}>
            <i className="fa-solid fa-user-circle text-lg text-ive-text-dim" />
            <span className="flex-1 text-sm font-bold text-ive-text truncate">@{name}</span>
            {!disabled && (
              <button type="button" onClick={() => put({ authorAllowlist: data.authorAllowlist.filter(n => n !== name) })}
                className="text-ive-red/60 hover:text-ive-red transition-colors p-1" title={tc('delete')}>
                <i className="fa-solid fa-xmark" />
              </button>
            )}
          </div>
        ))}
        {!disabled && (
          <div className="flex gap-2">
            <input value={allowInput} onChange={e => setAllowInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addAllow() } }}
              placeholder={t('authorAllowlistPlaceholder')} className={INPUT_CLS} />
            <button type="button" disabled={!allowInput.trim() || saving} onClick={addAllow} className={OUTLINE_BTN}>
              <i className="fa-solid fa-plus mr-1" />{t('add')}
            </button>
          </div>
        )}
        <p className="text-xs text-ive-text-dim"><i className="fa-solid fa-info-circle mr-1" />{t('authorAllowlistHint')}</p>
      </div>

      {/* staging 비밀값 — 관리자 설정 비밀번호 칸과 같은 「저장됨 + 변경」 */}
      <div className="border-t border-ive-border-dark pt-3 space-y-2">
        <label className={SUB_LABEL}><i className="fa-solid fa-key mr-1.5 text-xs" />{t('stagingSecrets')}</label>
        {data.stagingSecretNames.map(n => (
          <div key={n} className="space-y-1">
            <span className="block text-xs font-bold text-ive-text-muted font-mono ml-1">{n}</span>
            {changing[n] === undefined ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-xs text-ive-green flex items-center gap-1.5">
                  <i className="fa-solid fa-circle-check" /><span>{t('secretSaved')}</span>
                </div>
                {!stagingDisabled && (
                  <>
                    <button type="button" onClick={() => setChanging(c => ({ ...c, [n]: '' }))}
                      className="px-3 py-2 text-xs font-bold bg-ive-bg-deep border border-ive-border-subtle text-ive-text-dim rounded-lg active:scale-[0.98] transition-all">
                      {t('secretChange')}
                    </button>
                    <button type="button" onClick={() => put({ stagingSecrets: { [n]: null } })}
                      className="text-ive-red/60 hover:text-ive-red transition-colors p-1" title={tc('delete')}>
                      <i className="fa-solid fa-xmark" />
                    </button>
                  </>
                )}
              </div>
            ) : (
              <input
                type="password" autoComplete="new-password" autoFocus
                value={changing[n]}
                onChange={e => setChanging(c => ({ ...c, [n]: e.target.value }))}
                onKeyDown={noSubmit}
                onBlur={async () => {
                  const v = changing[n]
                  if (v) await put({ stagingSecrets: { [n]: v } })
                  setChanging(c => { const x = { ...c }; delete x[n]; return x })
                }}
                placeholder={t('secretNewValue')}
                className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green/50"
              />
            )}
          </div>
        ))}
        {!stagingDisabled && (
          <div className="flex gap-2">
            <input onKeyDown={noSubmit} value={secretName} onChange={e => setSecretName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
              placeholder="STAGING_TEST_PASSWORD" className={`${INPUT_CLS} font-mono`} />
            <input onKeyDown={noSubmit} type="password" autoComplete="new-password" value={secretValue} onChange={e => setSecretValue(e.target.value)}
              placeholder={t('secretValue')} className={INPUT_CLS} />
            <button type="button" disabled={!secretName || !secretValue || saving}
              onClick={async () => { if (await put({ stagingSecrets: { [secretName]: secretValue } })) { setSecretName(''); setSecretValue('') } }}
              className={OUTLINE_BTN}>
              <i className="fa-solid fa-plus mr-1" />{t('add')}
            </button>
          </div>
        )}
        <p className="text-xs text-ive-text-dim"><i className="fa-solid fa-info-circle mr-1" />{t('stagingSecretsHint')}</p>
      </div>

      {/* 상한 — 프로젝트 설정의 스테퍼 */}
      <div className="border-t border-ive-border-dark pt-3 space-y-3">
        {(Object.keys(LIMIT_RANGE) as (keyof Limits)[]).map(k => (
          <div key={k}>
            <label className={SUB_LABEL}>{t(`limit_${k}`)}</label>
            <Stepper
              value={data.limits[k]} min={LIMIT_RANGE[k][0]} max={LIMIT_RANGE[k][1]} disabled={disabled || saving}
              onChange={v => put({ limits: { [k]: v } })}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
