'use client'

import type React from 'react'

/**
 * textarea 에 붙여 넣거나 드롭한 이미지를 프로젝트 저장소(GitLab/GitHub)에
 * 업로드하고 결과 마크다운을 커서 위치에 삽입하는 유틸.
 *
 * 사용 예:
 *   const handlers = createImagePasteHandlers({
 *     projectId,
 *     getValue: () => newBody,
 *     setValue: v => handleBodyChange(v),
 *     onError: msg => toast(msg, 'error'),
 *   })
 *   <textarea onPaste={handlers.onPaste} onDrop={handlers.onDrop} ... />
 */

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|heic|bmp|avif)$/i

async function uploadFileToProject(projectId: string, file: File): Promise<{ markdown: string; url: string }> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(`/api/projects/${projectId}/uploads`, { method: 'POST', body: fd })
  if (!res.ok) {
    let msg = `업로드 실패 (${res.status})`
    try {
      const data = await res.json()
      if (data?.error) msg = data.error
    } catch {
      // ignore
    }
    throw new Error(msg)
  }
  return res.json()
}

function collectClipboardImages(items: DataTransferItemList | null): File[] {
  if (!items) return []
  const out: File[] = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.kind !== 'file') continue
    const f = it.getAsFile()
    if (!f) continue
    if (f.type.startsWith('image/') || IMAGE_EXT_RE.test(f.name)) out.push(f)
  }
  return out
}

function collectDropImages(dt: DataTransfer | null): File[] {
  if (!dt || !dt.files || dt.files.length === 0) return []
  const out: File[] = []
  for (let i = 0; i < dt.files.length; i++) {
    const f = dt.files[i]
    if (f.type.startsWith('image/') || IMAGE_EXT_RE.test(f.name)) out.push(f)
  }
  return out
}

function insertAt(value: string, ta: HTMLTextAreaElement, text: string): { next: string; caret: number } {
  const start = ta.selectionStart ?? value.length
  const end = ta.selectionEnd ?? value.length
  const before = value.slice(0, start)
  const after = value.slice(end)
  return { next: before + text + after, caret: start + text.length }
}

export interface PasteUploadOptions {
  /** 업로드 대상 프로젝트. 빈 값이면 업로드 동작 없이 기본 붙여넣기 동작이 유지됩니다. */
  projectId: string | null | undefined
  /** 현재 textarea 값을 반환합니다 (React state 기준). */
  getValue: () => string
  /** 새 값으로 업데이트합니다. */
  setValue: (next: string) => void
  /** 업로드 실패 시 호출되는 콜백. 토스트로 알림을 띄울 때 사용하세요. */
  onError?: (message: string) => void
}

export interface PasteUploadHandlers {
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void
  onDrop: (e: React.DragEvent<HTMLTextAreaElement>) => void
  onDragOver: (e: React.DragEvent<HTMLTextAreaElement>) => void
}

export function createImagePasteHandlers(opts: PasteUploadOptions): PasteUploadHandlers {
  let counter = 0

  const uploadMany = async (ta: HTMLTextAreaElement, files: File[]) => {
    if (!opts.projectId) {
      opts.onError?.('프로젝트가 선택되지 않았습니다.')
      return
    }
    for (const file of files) {
      const id = ++counter
      const placeholder = `![업로드 중… (${id})]()`
      // 1) 플레이스홀더 삽입
      {
        const value = opts.getValue()
        const { next, caret } = insertAt(value, ta, placeholder)
        opts.setValue(next)
        // 커서 위치를 보정
        requestAnimationFrame(() => {
          try {
            ta.focus()
            ta.setSelectionRange(caret, caret)
          } catch {
            // ignore
          }
        })
      }
      // 2) 실제 업로드 후 플레이스홀더를 실제 마크다운으로 치환
      try {
        const { markdown } = await uploadFileToProject(opts.projectId, file)
        const current = opts.getValue()
        const idx = current.lastIndexOf(placeholder)
        const next = idx >= 0
          ? current.slice(0, idx) + markdown + current.slice(idx + placeholder.length)
          : current + (current.endsWith('\n') || current.length === 0 ? '' : '\n') + markdown
        opts.setValue(next)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // 플레이스홀더 제거
        const current = opts.getValue()
        const next = current.replace(placeholder, '')
        opts.setValue(next)
        opts.onError?.(msg)
      }
    }
  }

  return {
    onPaste: (e) => {
      const files = collectClipboardImages(e.clipboardData?.items ?? null)
      if (files.length === 0) return
      e.preventDefault()
      uploadMany(e.currentTarget, files)
    },
    onDrop: (e) => {
      const files = collectDropImages(e.dataTransfer)
      if (files.length === 0) return
      e.preventDefault()
      uploadMany(e.currentTarget, files)
    },
    onDragOver: (e) => {
      // 이미지 드래그 중일 때 textarea 가 드롭을 허용하도록
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault()
      }
    },
  }
}
