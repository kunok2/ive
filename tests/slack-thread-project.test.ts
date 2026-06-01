/**
 * selectThreadProject 회귀 테스트 — 스레드 프로젝트 바인딩 규칙
 *
 * 설계(여러 번의 시행착오 끝에 확정):
 *   스레드는 "프로젝트 없음(일반 대화)"으로 시작한다. 임의로 첫 프로젝트를 잡거나(잘못된 단정),
 *   되묻지(무한 루프) 않는다. 사용자가 프로젝트 이름을 거론하면 그때 자연스럽게 바인딩되고,
 *   한번 바인딩되면 다른 프로젝트 이름을 말하기 전까지 유지된다.
 *
 * 과거 장애:
 *   - 이름 없는 후속 질문이 ownerProjects[0]로 튀어 한 스레드에서 프로젝트가 바뀜.
 *   - 그걸 "되묻기"로 막으려다, 한글 이름("스프링크")이 영문 프로젝트명("splink")과 매칭 안 돼
 *     사용자가 영원히 빠져나올 수 없는 되묻기 루프 발생.
 *   이 테스트는 두 회귀를 모두 빌드 단계에서 잡는다.
 *
 * 불변식:
 *   T-0: 첫 멘션 + 이름 명시       → 그 프로젝트
 *   T-1: 첫 멘션 + 이름 없음       → null (프로젝트 없음 = 일반 대화). ★[0] 단정·되묻기 안 함
 *   T-2: 고정 스레드 + 이름 없음   → 고정 프로젝트 유지 (★[0]로 안 튐)
 *   T-3: 고정 스레드 + 다른 이름   → 그 프로젝트 (전환)
 *   T-4: 프로젝트없음 세션 + 이름  → 그 프로젝트 (바인딩)
 *   T-5: 프로젝트없음 세션 + 이름無 → null 유지 (루프 없음)
 *   T-6: 고정 프로젝트 삭제됨+이름無 → null (못 찾으면 일반 대화로 폴백)
 *   T-7: 대소문자 무시 매칭
 */
import { describe, it, expect } from 'vitest'
import { selectThreadProject, matchProjectByName } from '@/lib/slack'

// apm 이 [0], splink 가 두 번째 — 과거 "[0]로 튐" 장애 재현 순서.
const APM = { id: 'p-apm', name: 'springware-apm' }
const SPLINK = { id: 'p-splink', name: 'splink' }
const IVE = { id: 'p-ive', name: 'IVE' }
const ownerProjects = [APM, SPLINK, IVE]

describe('selectThreadProject — 프로젝트 없음으로 시작, 거론 시 바인딩', () => {
  it('T-0: 첫 멘션에 프로젝트 이름을 명시하면 그 프로젝트', () => {
    expect(selectThreadProject({ ownerProjects, session: null, cleanText: 'splink 에 대해 이야기하자' })).toBe(SPLINK)
  })

  it('T-1: ★ 첫 멘션에 이름이 없으면 null(프로젝트 없음). [0] 단정도 되묻기도 안 한다', () => {
    expect(selectThreadProject({ ownerProjects, session: null, cleanText: '안녕? 오늘 뭐하지' })).toBeNull()
  })

  it('T-2: ★ splink 에 고정된 스레드에서 이름 없는 후속 질문은 splink 유지 (ownerProjects[0]로 안 튐)', () => {
    const session = { projectId: SPLINK.id }
    for (const text of ['스파이더가 뭐야?', '전문이 뭐야?', '지금까지 대화 정리해줘', '다시 이미지 그려줘']) {
      expect(selectThreadProject({ ownerProjects, session, cleanText: text }), `"${text}"`).toBe(SPLINK)
    }
  })

  it('T-3: 고정된 스레드에서 다른 프로젝트 이름을 거론하면 그 프로젝트로', () => {
    expect(selectThreadProject({ ownerProjects, session: { projectId: SPLINK.id }, cleanText: 'springware-apm 빌드 봐줘' })).toBe(APM)
  })

  it('T-4: 프로젝트 없음 세션에서 프로젝트 이름을 거론하면 그 프로젝트로 바인딩', () => {
    expect(selectThreadProject({ ownerProjects, session: { projectId: null }, cleanText: 'splink 구조 알려줘' })).toBe(SPLINK)
  })

  it('T-5: ★ 프로젝트 없음 세션에서 이름이 없으면 계속 null (되묻기 루프 없음)', () => {
    const session = { projectId: null }
    for (const text of ['그게 무슨 뜻이야?', '고마워', '스프링크 이야기 하고 있었잖아']) {
      // "스프링크"(한글)는 "splink"와 매칭 안 됨 → null 유지. 과거엔 여기서 되묻기 루프.
      expect(selectThreadProject({ ownerProjects, session, cleanText: text }), `"${text}"`).toBeNull()
    }
  })

  it('T-6: 고정 프로젝트가 삭제돼 못 찾고 이름도 없으면 null(일반 대화로 폴백)', () => {
    expect(selectThreadProject({ ownerProjects, session: { projectId: 'p-deleted' }, cleanText: '계속하자' })).toBeNull()
  })

  it('T-7: 이름 매칭은 대소문자를 무시한다', () => {
    expect(selectThreadProject({ ownerProjects, session: null, cleanText: 'SPLINK 보여줘' })).toBe(SPLINK)
    expect(selectThreadProject({ ownerProjects, session: null, cleanText: 'Springware-APM 어때' })).toBe(APM)
  })
})

describe('matchProjectByName', () => {
  it('이름이 포함되면 매칭(대소문자 무시), 없으면 null', () => {
    expect(matchProjectByName(ownerProjects, '이 splink 좀')).toBe(SPLINK)
    expect(matchProjectByName(ownerProjects, '아무 프로젝트 얘기 안 함')).toBeNull()
  })
})
