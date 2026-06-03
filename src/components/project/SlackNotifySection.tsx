'use client'

import { useTranslations } from 'next-intl'

export interface SlackNotifySectionProps {
  channel: string
  onChannelChange: (v: string) => void
}

// 붙여넣은 값에서 Slack 채널 ID를 뽑아낸다.
// - 채널 링크(https://app.slack.com/client/T…/C0123ABCD) → 끝의 C/G/D 토큰
// - 이미 ID면 그대로
// 팀 ID(T…)는 제외하고 채널/그룹/DM ID만 매칭.
function normalizeChannelId(input: string): string {
  const v = input.trim()
  const m = v.match(/[CGD][A-Z0-9]{6,}/)
  return m ? m[0] : v
}

// 작업완료 Slack 알림 채널 설정.
// 알림 자체는 이슈에 알림 라벨(IVE-N)이 붙고 담당자가 수신 ON 일 때만 발송된다.
// 워크스페이스는 활성 워크스페이스로 자동 해석되므로 여기서는 채널만 지정한다.
export default function SlackNotifySection({ channel, onChannelChange }: SlackNotifySectionProps) {
  const t = useTranslations('project')

  return (
    <div className="border-t border-ive-border-dark pt-3">
      <label className="block text-sm font-bold text-ive-text-muted mb-1.5 uppercase ml-1">
        <i className="fa-brands fa-slack mr-1.5 text-xs" />
        {t('slackNotifyTitle')}
      </label>
      <p className="text-xs text-ive-text-dim mb-3 ml-1 leading-relaxed">
        {t('slackNotifyHint')}
      </p>

      <div className="flex items-center gap-2 ml-1">
        <span className="text-xs font-bold text-ive-text-muted shrink-0">
          {t('slackNotifyChannelLabel')}
        </span>
        <input
          type="text"
          value={channel}
          onChange={e => onChannelChange(e.target.value)}
          onBlur={e => { const id = normalizeChannelId(e.target.value); if (id !== e.target.value) onChannelChange(id) }}
          placeholder="C0123ABCD 또는 채널 링크 붙여넣기"
          className="flex-1 min-w-0 bg-ive-bg-deep border border-ive-border rounded-lg px-3 py-1.5 text-sm text-ive-text focus:outline-none focus:border-ive-green font-mono"
        />
      </div>
      <p className="text-[10px] text-ive-text-dim/70 mt-1.5 ml-1 leading-relaxed">
        {t('slackNotifyChannelDesc')}
      </p>
    </div>
  )
}
