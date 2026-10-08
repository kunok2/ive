/**
 * 새 프로젝트의 기본 레이블 이름 — 단 하나의 출처.
 *
 * 레이블 이름은 프로젝트마다 DB(projects.label_*)에 저장된 설정값이다. 이 값은 새로 등록하는
 * 프로젝트의 기본값일 뿐이라, 예전 기본값(IVE, IVE-S …)으로 등록된 프로젝트는 저장된 이름을
 * 그대로 쓴다(이미 붙은 레이블을 다시 달 수 없으므로 하위 호환).
 */
export const DEFAULT_LABELS = {
  target: 'ive',
  schedule: 'ive:todo',
  dev: 'ive:doing',
  verifyWait: 'ive:verify-wait',
  verify: 'ive:verifying',
  confirmWait: 'ive:confirm-wait',
  confirm: 'ive:confirming',
  end: 'ive:done',
  notify: 'ive:notify',
} as const

/** 예전 기본값 — 그 시절 등록된 프로젝트의 DB 값. 기존 DB 에 열을 더할 때(ALTER) 기존 행에 채운다. */
export const LEGACY_LABELS = {
  target: 'IVE',
  schedule: 'IVE-S',
  dev: 'IVE-D',
  verifyWait: 'IVE-W',
  verify: 'IVE-V',
  confirmWait: 'IVE-P',
  confirm: 'IVE-C',
  end: 'IVE-E',
  notify: 'IVE-N',
} as const
