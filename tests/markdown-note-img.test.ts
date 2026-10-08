/**
 * 이슈 본문·코멘트의 HTML <img> 태그.
 * GitHub 은 붙여 넣은 이미지를 `<img width=… alt=… src=…>` 로 넣는데, 마크다운 렌더러는 HTML 을 그리지 않아
 * 태그 글자가 그대로 보였다(spider-framework #1339). cleanNoteBody 가 마크다운 이미지로 바꾸고,
 * MarkdownNote 가 GitHub 첨부를 서버 프록시 주소로 바꿔 그린다.
 */
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import MarkdownNote, { cleanNoteBody } from '@/components/ui/MarkdownNote'

const ATT = 'https://github.com/user-attachments/assets/e6320234-c896-463a-89a1-7091b313142a'

describe('cleanNoteBody: <img> → 마크다운 이미지', () => {
  it('GitHub 이 넣는 <img> 태그', () => {
    expect(cleanNoteBody(`<img width="1231" height="89" alt="Image" src="${ATT}" />`)).toBe(`![Image](${ATT})`)
  })
  it('alt 없음·작은따옴표·닫는 / 없음', () => {
    expect(cleanNoteBody(`<img src='${ATT}'>`)).toBe(`![](${ATT})`)
  })
  it('src 없는 태그는 지운다', () => {
    expect(cleanNoteBody('앞 <img alt="x"> 뒤')).toBe('앞  뒤')
  })
})

describe('MarkdownNote: 렌더 결과에 태그 글자가 남지 않고 프록시 주소 <img> 가 된다', () => {
  it('코멘트 본문 그대로', () => {
    const body = cleanNoteBody(`확인 화면\n<img width="1231" height="89" alt="Image" src="${ATT}" />\n끝`)
    const html = renderToStaticMarkup(createElement(MarkdownNote, { body, projectId: 'p1' }))
    expect(html).not.toContain('&lt;img')
    expect(html).toContain(`src="/api/projects/p1/attachment?url=${encodeURIComponent(ATT)}"`)
    expect(html).toContain('alt="Image"')
  })
})
