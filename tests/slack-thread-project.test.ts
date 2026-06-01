/**
 * selectThreadProject 회귀 테스트 — 스레드 프로젝트 고정 불변식
 *
 * 배경(실제 장애):
 *   슬랙에서 "splink 이야기하자"로 시작한 스레드인데, 이름이 안 들어간 후속 질문
 *   ("스파이더가 뭐야?", "현재 프로젝트?")에서 IVE 가 매번 ownerProjects[0](=다른 프로젝트)
 *   로 되돌아가, 한 스레드 안에서 프로젝트(=워크스페이스/CLI 세션)가 튀고 대화 맥락이 끊겼다.
 *   원인은 프로젝트를 "스레드 세션에 저장된 projectId" 가 아니라 "매 메시지 텍스트" 로 다시
 *   고른 것. 이 테스트는 그 회귀를 빌드 단계에서 잡는다.
 *
 * 불변식:
 *   T-0: 첫 멘션 + 이름 명시         → 그 프로젝트, switching=false, 모호함 없음
 *   T-1: 첫 멘션 + 이름 없음(후보 여럿) → needsDisambiguation=true (★[0] 단정 대신 되묻기)
 *   T-2: 고정된 스레드 + 이름 없음   → 고정 프로젝트 유지 (★핵심 회귀: [0]로 안 튐)
 *   T-3: 고정된 스레드 + 다른 이름   → 그 프로젝트, switching=true
 *   T-4: 고정된 스레드 + 같은 이름   → 고정 프로젝트, switching=false (재명시는 전환 아님)
 *   T-5: 고정 프로젝트가 삭제됨      → 되묻기(needsDisambiguation=true)
 *   T-7: 프로젝트가 하나뿐 + 이름 없음 → 모호함 없이 그 프로젝트
 */
import { describe, it, expect } from 'vitest'
import { selectThreadProject } from '@/lib/slack'

// 실제 장애 재현용 프로젝트 목록. 순서가 중요(apm 이 [0], splink 가 두 번째).
const APM = { id: 'p-apm', name: 'springware-apm' }
const SPLINK = { id: 'p-splink', name: 'splink' }
const IVE = { id: 'p-ive', name: 'IVE' }
const ownerProjects = [APM, SPLINK, IVE]

describe('selectThreadProject — 스레드 프로젝트 고정', () => {
  it('T-0: 첫 멘션에 프로젝트 이름을 명시하면 그 프로젝트', () => {
    const { project, switching, needsDisambiguation } = selectThreadProject({
      ownerProjects, session: null, cleanText: 'splink 에 대해 이야기하자',
    })
    expect(project).toBe(SPLINK)
    expect(switching).toBe(false)
    expect(needsDisambiguation).toBe(false)
  })

  it('T-1: ★ 첫 멘션에 이름이 없고 후보가 여럿이면, [0]을 단정하지 말고 되묻는다(needsDisambiguation)', () => {
    const { needsDisambiguation } = selectThreadProject({
      ownerProjects, session: null, cleanText: '안녕?',
    })
    expect(needsDisambiguation).toBe(true)
  })

  it('T-2: ★ 스레드가 splink 에 고정되면, 이름 없는 후속 질문은 splink 를 유지한다 (ownerProjects[0]로 튀지 않음)', () => {
    const session = { projectId: SPLINK.id }
    for (const text of ['스파이더가 뭐야?', '현재 프로젝트?', '전문이 뭐야?', '지금까지 대화를 정리해줘']) {
      const { project, switching, needsDisambiguation } = selectThreadProject({ ownerProjects, session, cleanText: text })
      expect(project, `"${text}" 에서 splink 가 유지되어야 함`).toBe(SPLINK)
      expect(switching).toBe(false)
      expect(needsDisambiguation).toBe(false)
    }
  })

  it('T-3: 고정된 스레드에서 다른 프로젝트 이름을 명시하면 전환(switching=true)', () => {
    const { project, switching, needsDisambiguation } = selectThreadProject({
      ownerProjects, session: { projectId: SPLINK.id }, cleanText: 'springware-apm 으로 바꿔',
    })
    expect(project).toBe(APM)
    expect(switching).toBe(true)
    expect(needsDisambiguation).toBe(false)
  })

  it('T-4: 고정된 프로젝트와 같은 이름을 다시 말해도 전환이 아니다', () => {
    const { project, switching } = selectThreadProject({
      ownerProjects, session: { projectId: SPLINK.id }, cleanText: 'splink 빌드 상태 봐줘',
    })
    expect(project).toBe(SPLINK)
    expect(switching).toBe(false)
  })

  it('T-5: 세션에 고정된 프로젝트가 삭제돼 못 찾고 이름도 없으면, 되묻는다(needsDisambiguation)', () => {
    const { needsDisambiguation } = selectThreadProject({
      ownerProjects, session: { projectId: 'p-deleted' }, cleanText: '계속 진행',
    })
    expect(needsDisambiguation).toBe(true)
  })

  it('T-6: 세션 projectId 가 null 이고(레거시 행) 이름도 없으면 되묻는다', () => {
    const { needsDisambiguation } = selectThreadProject({
      ownerProjects, session: { projectId: null }, cleanText: '뭐 좀 물어보자',
    })
    expect(needsDisambiguation).toBe(true)
  })

  it('T-7: 프로젝트가 하나뿐이면 이름이 없어도 모호함 없이 그 프로젝트', () => {
    const { project, needsDisambiguation } = selectThreadProject({
      ownerProjects: [SPLINK], session: null, cleanText: '안녕?',
    })
    expect(project).toBe(SPLINK)
    expect(needsDisambiguation).toBe(false)
  })
})
