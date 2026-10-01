'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import RolesPanel from './RolesPanel'
import PromptsPanel from './PromptsPanel'
import AutomationPanel from './AutomationPanel'
import { Segmented } from './shared'

type Tab = 'roles' | 'prompts' | 'automation'

/**
 * 프로젝트 상세 화면 — 역할·단계 자동화 (멤버 목록 아래). 바뀌면 바로 저장.
 * 누구에게 어떤 역할을 맡기고 단계를 어떻게 자동으로 돌릴지는 프로젝트 메타(프로젝트 설정)가 아니라 운영 배정이므로
 * 프로젝트 설정 모달이 아니라 이 화면에 둔다.
 *   역할: 누가(사람·에이전트) 처리·검증·확인을 할 수 있는가 (역할 명부)
 *   프롬프트: 역할별 에이전트 지시문 (편집 가능한 부분 + IVE 고정 부분)
 *   자동화: 기본 배정(「모든 단계 자동배정」), staging·배포 커밋 확인, 묶음 배포, 작성자 허용 목록, staging 비밀값, 상한
 */
export default function StageAutomationSection({ projectId }: { projectId: string }) {
  const t = useTranslations('automation')
  const [tab, setTab] = useState<Tab>('roles')

  return (
    <div className="mt-6">
      <h2 className="text-base font-bold text-ive-text uppercase tracking-widest flex items-center gap-2 mb-3 px-1">
        <span className="w-1.5 h-1.5 rounded-full bg-ive-cyan" />
        {t('sectionTitle')}
      </h2>
      <div className="bg-ive-bg-card rounded-lg border border-ive-border-subtle p-4 space-y-3">
        <p className="text-xs text-ive-text-dim"><i className="fa-solid fa-info-circle mr-1" />{t('sectionHint')}</p>
        <Segmented
          value={tab}
          onChange={setTab}
          items={[
            { value: 'roles', label: t('tabRoles'), icon: 'fa-people-group' },
            { value: 'prompts', label: t('tabPrompts'), icon: 'fa-file-lines' },
            { value: 'automation', label: t('tabAutomation'), icon: 'fa-gears' },
          ]}
        />
        {tab === 'roles' && <RolesPanel projectId={projectId} />}
        {tab === 'prompts' && <PromptsPanel projectId={projectId} />}
        {tab === 'automation' && <AutomationPanel projectId={projectId} />}
      </div>
    </div>
  )
}
