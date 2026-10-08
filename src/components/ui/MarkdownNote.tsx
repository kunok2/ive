'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { isGitHubAttachmentUrl } from '@/lib/github-attachment'

/** 노트 본문 정리: 도구 태그 제거, HTML 태그를 MD로 변환, ANSI 이스케이프 제거 */
export function cleanNoteBody(body: string): string {
  return body
    // ANSI 이스케이프 시퀀스 제거 (터미널 출력이 노트에 포함된 경우)
    .replace(/\x1b\[[0-9;?]*[A-Za-z@]/g, '')
    .replace(/\x1b\][^\x07\x1b]*\x07/g, '')
    .replace(/\x1b[a-zA-Z]/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .filter(line => !line.match(/^>\s*\*{0,2}🔧/))
    .join('\n')
    .replace(/<details>/gi, '')
    .replace(/<\/details>/gi, '')
    .replace(/<summary>(.*?)<\/summary>/gi, '**$1**')
    .replace(/<\/?br\s*\/?>/gi, '\n')
    // <img> 태그 → 마크다운 이미지 (GitHub 은 붙여 넣은 이미지를 HTML 태그로 넣는다 — 그대로 두면 태그 글자가 보인다)
    .replace(/<img\b[^>]*>/gi, tag => {
      const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1]
      if (!src) return ''
      const alt = (tag.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] || '').replace(/[[\]]/g, '')
      return `![${alt}](${src})`
    })
    .replace(/<\/?(?:div|span|p)[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\n{3,}/g, '\n\n')
    // GitLab처럼 단일 개행을 <br>로 렌더하기 위해 마크다운 hard break(공백 2 + 개행)로 치환
    // (\n\n은 문단 경계로 유지되도록 건드리지 않음)
    .replace(/([^\n])\n([^\n])/g, '$1  \n$2')
    .trim()
}

export default function MarkdownNote({ body, projectId }: { body: string; projectId?: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h1 className="text-base font-bold text-ive-text mt-2 mb-1">{children}</h1>,
        h2: ({ children }) => <h2 className="text-sm font-bold text-ive-text mt-2 mb-1">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-bold text-ive-text mt-1.5 mb-0.5">{children}</h3>,
        p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="list-disc list-inside mb-1.5 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal list-inside mb-1.5 space-y-0.5">{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        strong: ({ children }) => <strong className="font-bold text-ive-text">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        code: ({ children, className }) => {
          const isBlock = className?.includes('language-')
          if (isBlock) {
            return <code className="block bg-ive-bg-deep rounded-lg p-2 my-1.5 text-xs font-mono overflow-x-auto whitespace-pre">{children}</code>
          }
          return <code className="bg-ive-bg-deep px-1 py-0.5 rounded text-xs font-mono text-ive-text">{children}</code>
        },
        pre: ({ children }) => <pre className="mb-1.5">{children}</pre>,
        blockquote: ({ children }) => <blockquote className="border-l-2 border-ive-border pl-2.5 my-1.5 text-ive-text-dim">{children}</blockquote>,
        img: ({ src, alt, ...rest }) => {
          let resolvedSrc = String(src || '')
          if (projectId && resolvedSrc.startsWith('/uploads/')) {
            resolvedSrc = `/api/projects/${projectId}${resolvedSrc}`
          } else if (projectId && isGitHubAttachmentUrl(resolvedSrc)) {
            // private 저장소 GitHub 첨부는 브라우저가 직접 못 연다(404) — 서버 프록시 경유
            resolvedSrc = `/api/projects/${projectId}/attachment?url=${encodeURIComponent(resolvedSrc)}`
          }
          return <img src={resolvedSrc} alt={alt || ''} className="max-w-full rounded-lg my-1" {...rest} />
        },
        a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-ive-cyan hover:underline">{children}</a>,
        hr: () => <hr className="border-ive-border-dark my-2" />,
        table: ({ children }) => <table className="w-full border-collapse my-2 text-sm">{children}</table>,
        thead: ({ children }) => <thead className="bg-ive-bg-deep">{children}</thead>,
        tbody: ({ children }) => <tbody>{children}</tbody>,
        tr: ({ children }) => <tr className="border-b border-ive-border-dark">{children}</tr>,
        th: ({ children }) => <th className="border border-ive-border-dark px-2 py-1 text-left font-bold text-ive-text">{children}</th>,
        td: ({ children }) => <td className="border border-ive-border-dark px-2 py-1 text-ive-text-dim">{children}</td>,
      }}
    >
      {body}
    </ReactMarkdown>
  )
}
