import type { User } from '@/types'
import type { MultiSelectOption } from '@/components/ui/MultiSelectPicker'

/**
 * 사용자를 선택/필터 UI의 옵션으로 변환한다.
 * 표시 형태는 어디서나 동일하게 `아바타 + 이름(이메일)` 로 통일한다.
 *  - label  : 이름
 *  - hint   : 이메일(=로그인 식별자)
 *  - avatar : 사용자 아바타 (사진이면 avatarUserId로 사진 URL 변환)
 */
export function userToOption(u: Pick<User, 'id' | 'name' | 'email' | 'avatar'>): MultiSelectOption {
  return {
    value: u.id,
    label: u.name,
    hint: u.email,
    avatar: u.avatar,
    avatarUserId: u.id,
  }
}
