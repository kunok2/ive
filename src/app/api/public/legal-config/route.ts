import { NextResponse } from 'next/server'
import { getLegalConfig } from '@/lib/legal-config'

// 로그인/회원가입 화면(비인증)에서 동의 문구·약관 링크 표시 여부와 운영주체 정보를 읽기 위한 공개 엔드포인트.
// 민감 정보는 포함하지 않는다(상호·주소·담당자 연락처는 약관에 공개되는 정보).
export async function GET() {
  return NextResponse.json(getLegalConfig())
}
