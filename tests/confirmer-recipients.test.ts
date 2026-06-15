/**
 * 확인자(확인 단계) 알림/후보 해석 — 확인자는 프로젝트 멤버가 아니어도 IVE 사용자이면 된다.
 *
 * 검증 불변식:
 *   C-1: 지정 확인자(preset specific)는 이슈 assignee 가 아니어도(=비멤버) 직접 수신자가 된다.
 *   C-2: 지정 확인자가 Slack 수신거부(slack_notify=0)면 빈 결과 — assignee 로 fallback 하지 않는다.
 *   C-3: 지정 확인자가 없으면(creator/auto) 기존처럼 현재 assignee 기준으로 해석한다.
 *   C-4: getIveConfirmerCandidates 는 해당 provider 로 식별되는 IVE 사용자만 반환(타 provider 제외).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import type { Project } from '@/types'
import { resolveConfirmRecipients } from '@/lib/slack-notify'
import { getIveConfirmerCandidates, setPresetRoles } from '@/lib/db'

let db: Database.Database

const project = { id: 'p1', provider: 'gitlab' } as unknown as Project

function setup() {
  const d = new Database(':memory:')
  d.exec(`
    CREATE TABLE oauth_providers (id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT, base_url TEXT, client_id TEXT, client_secret TEXT, enabled INTEGER DEFAULT 1);
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT, password TEXT DEFAULT '', name TEXT, avatar TEXT DEFAULT 'av-01',
      is_admin INTEGER DEFAULT 0, oauth_provider_id TEXT, oauth_user_id TEXT,
      gitlab_username TEXT, github_username TEXT, slack_user_id TEXT DEFAULT '', slack_notify INTEGER DEFAULT 1, locale TEXT
    );
    CREATE TABLE issue_stages (
      project_id TEXT NOT NULL, issue_iid INTEGER NOT NULL, stage TEXT DEFAULT '', updated_at TEXT,
      preset_verifier_mode TEXT DEFAULT 'creator', preset_verifier_user_id TEXT, preset_verifier_username TEXT,
      preset_confirmer_mode TEXT DEFAULT 'creator', preset_confirmer_user_id TEXT, preset_confirmer_username TEXT,
      PRIMARY KEY (project_id, issue_iid)
    );
  `)
  d.prepare(`INSERT INTO oauth_providers (id, type, name) VALUES ('gl', 'gitlab', 'GitLab'), ('gh', 'github', 'GitHub')`).run()
  // 비멤버 확인자(슬랙 연결 O) — git id 700, gitlab 로그인
  d.prepare(`INSERT INTO users (id, name, oauth_provider_id, oauth_user_id, gitlab_username, slack_user_id, slack_notify)
             VALUES ('uC', 'Confirmer', 'gl', '700', 'conf', 'UCONF', 1)`).run()
  // 슬랙 수신거부 확인자 — git id 701
  d.prepare(`INSERT INTO users (id, name, oauth_provider_id, oauth_user_id, gitlab_username, slack_user_id, slack_notify)
             VALUES ('uV', 'Vetoer', 'gl', '701', 'veto', 'UVETO', 0)`).run()
  // assignee(멤버) — git id 800
  d.prepare(`INSERT INTO users (id, name, oauth_provider_id, oauth_user_id, gitlab_username, slack_user_id, slack_notify)
             VALUES ('uA', 'Assignee', 'gl', '800', 'asgn', 'UASGN', 1)`).run()
  // GitHub 로그인 사용자 — gitlab 후보에서 제외돼야 함
  d.prepare(`INSERT INTO users (id, name, oauth_provider_id, oauth_user_id, github_username, slack_user_id, slack_notify)
             VALUES ('uG', 'GithubUser', 'gh', '900', 'ghuser', 'UGH', 1)`).run()
  ;(globalThis as any).db = d
  return d
}

const issueWithAssignee = { assignees: [{ id: 800, username: 'asgn' }] }

beforeEach(() => { db = setup() })
afterEach(() => { db.close(); (globalThis as any).db = undefined })

describe('resolveConfirmRecipients', () => {
  it('C-1: 지정 확인자는 assignee 가 아니어도 직접 수신자가 된다', () => {
    setPresetRoles('p1', 1, { confirmer: { mode: 'specific', userId: '700', username: 'conf' } })
    const out = resolveConfirmRecipients(project, issueWithAssignee, 1)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ iveUserId: 'uC', slackUserId: 'UCONF' })
  })

  it('C-2: 지정 확인자가 수신거부면 빈 결과 (assignee 로 fallback 하지 않음)', () => {
    setPresetRoles('p1', 1, { confirmer: { mode: 'specific', userId: '701', username: 'veto' } })
    const out = resolveConfirmRecipients(project, issueWithAssignee, 1)
    expect(out).toHaveLength(0)
  })

  it('C-3: 지정 확인자가 없으면(creator) 현재 assignee 기준으로 해석', () => {
    setPresetRoles('p1', 1, { confirmer: { mode: 'creator', userId: null, username: null } })
    const out = resolveConfirmRecipients(project, issueWithAssignee, 1)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ iveUserId: 'uA', slackUserId: 'UASGN' })
  })
})

describe('getIveConfirmerCandidates', () => {
  it('C-4: gitlab provider 후보는 gitlab 로그인 사용자만 (github 제외)', () => {
    const cands = getIveConfirmerCandidates('gitlab')
    const ids = cands.map(c => c.id).sort((a, b) => a - b)
    expect(ids).toEqual([700, 701, 800])
    expect(cands.find(c => c.id === 700)).toMatchObject({ username: 'conf', name: 'Confirmer' })
  })
})
