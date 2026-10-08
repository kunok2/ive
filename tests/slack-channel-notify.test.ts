/**
 * 단계 알림의 채널 발송 — 프로젝트에 알림 채널을 정했으면 DM 과 같은 알림을 채널에도 올리고 담당자를 멘션한다.
 *  C-1 채널을 정했으면 채널 글 1건 + 수신을 켠 담당자에게 DM, 채널 글에 그 담당자 멘션
 *  C-2 채널을 비우면 채널 글은 없고 DM 만 (종전과 같음)
 *  C-3 수신을 켠 담당자가 없어도 채널을 정했으면 채널 글은 올린다(멘션 없이)
 *  C-4 알림 라벨이 없거나, 그 단계를 에이전트가 맡았으면 아무것도 보내지 않는다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  issue: null as any,
  users: new Map<string, any>(),
  preset: { verifier: { mode: 'creator' }, confirmer: { mode: 'creator' } } as any,
  dm: vi.fn(async () => true),
  channel: vi.fn(async () => true),
}))
vi.mock('@/lib/provider', () => ({ fetchSingleIssue: async () => m.issue }))
vi.mock('@/lib/slack', () => ({ sendSlackDM: m.dm, sendSlackChannelMessage: m.channel }))
vi.mock('@/lib/db', () => ({
  getUserByOAuthId: (_p: string, id: string) => m.users.get(id) ?? null,
  getUserByGitUsername: () => null,
  getSystemSetting: () => 'https://ive.example.com',
  getPresetRoles: () => m.preset,
}))

import { notifyStageTransition } from '@/lib/slack-notify'

const project = (channel = '') => ({ id: 'p1', provider: 'gitlab', labelNotify: 'ive:notify', slackNotifyChannel: channel, slackWorkspaceId: 'W1' }) as any
const lee = { id: 'u-lee', slackNotify: true, slackUserId: 'U_LEE', locale: 'ko' }

beforeEach(() => {
  m.dm.mockClear(); m.channel.mockClear()
  m.users = new Map([['7', lee]])
  m.preset = { verifier: { mode: 'creator' }, confirmer: { mode: 'creator' } }
  m.issue = { iid: 5, title: '버튼 정렬', labels: ['ive:verify-wait', 'ive:notify'], assignees: [{ id: 7, username: 'lee' }], web_url: 'https://gitlab/x/5' }
})

describe('단계 알림 채널 발송', () => {
  it('C-1 채널을 정했으면 채널 글 + DM, 채널 글에 담당자 멘션', async () => {
    await notifyStageTransition(project('C0123ABCD'), 5, 't', 'verify')
    expect(m.dm).toHaveBeenCalledOnce()
    expect(m.dm.mock.calls[0][1]).toBe('U_LEE')
    expect(m.channel).toHaveBeenCalledOnce()
    const [ws, ch, text] = m.channel.mock.calls[0] as unknown as [string, string, string]
    expect([ws, ch]).toEqual(['W1', 'C0123ABCD'])
    expect(text.startsWith('<@U_LEE> ')).toBe(true)
    expect(text).toContain('검증 요청')
    expect(text).toContain('#5 "버튼 정렬"')
  })

  it('C-2 채널을 비우면 DM 만', async () => {
    await notifyStageTransition(project(''), 5, 't', 'verify')
    expect(m.dm).toHaveBeenCalledOnce()
    expect(m.channel).not.toHaveBeenCalled()
  })

  it('C-3 수신을 켠 담당자가 없어도 채널 글은 올린다(멘션 없이)', async () => {
    m.users = new Map([['7', { ...lee, slackNotify: false }]])
    await notifyStageTransition(project('C0123ABCD'), 5, 't', 'verify')
    expect(m.dm).not.toHaveBeenCalled()
    expect(m.channel).toHaveBeenCalledOnce()
    expect((m.channel.mock.calls[0] as unknown as string[])[2]).not.toContain('<@')
  })

  it('C-4 알림 라벨이 없거나 에이전트가 맡은 단계면 보내지 않는다', async () => {
    m.issue.labels = ['ive:verify-wait']
    await notifyStageTransition(project('C0123ABCD'), 5, 't', 'verify')
    m.issue.labels = ['ive:verify-wait', 'ive:notify']
    m.preset = { verifier: { mode: 'agent' }, confirmer: { mode: 'creator' } }
    await notifyStageTransition(project('C0123ABCD'), 5, 't', 'verify')
    expect(m.dm).not.toHaveBeenCalled()
    expect(m.channel).not.toHaveBeenCalled()
  })
})
