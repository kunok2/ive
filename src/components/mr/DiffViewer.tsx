'use client'

import { useState } from 'react'

interface FileChange {
  old_path: string
  new_path: string
  new_file: boolean
  renamed_file: boolean
  deleted_file: boolean
  diff: string
}

interface DiffLine {
  type: 'add' | 'del' | 'context' | 'header'
  content: string
  oldLine?: number
  newLine?: number
}

function parseDiff(diff: string): DiffLine[] {
  const lines = diff.split('\n')
  const result: DiffLine[] = []
  let oldLine = 0
  let newLine = 0

  for (const line of lines) {
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (match) {
        oldLine = parseInt(match[1], 10)
        newLine = parseInt(match[2], 10)
      }
      result.push({ type: 'header', content: line })
    } else if (line.startsWith('+')) {
      result.push({ type: 'add', content: line.slice(1), newLine })
      newLine++
    } else if (line.startsWith('-')) {
      result.push({ type: 'del', content: line.slice(1), oldLine })
      oldLine++
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file" 등 무시
    } else {
      result.push({ type: 'context', content: line.startsWith(' ') ? line.slice(1) : line, oldLine, newLine })
      oldLine++
      newLine++
    }
  }

  return result
}

function countChanges(diff: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++
    else if (line.startsWith('-') && !line.startsWith('---')) removed++
  }
  return { added, removed }
}

function FileLabel({ change }: { change: FileChange }) {
  if (change.new_file) return <span className="text-xs text-ive-green bg-ive-green/15 px-1.5 py-0.5 rounded font-bold">NEW</span>
  if (change.deleted_file) return <span className="text-xs text-ive-red bg-ive-red/15 px-1.5 py-0.5 rounded font-bold">DEL</span>
  if (change.renamed_file) return <span className="text-xs text-ive-amber bg-ive-amber/15 px-1.5 py-0.5 rounded font-bold">REN</span>
  return null
}

export default function DiffViewer({ changes }: { changes: FileChange[] }) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>(() => {
    const init: Record<number, boolean> = {}
    changes.forEach((_, i) => { init[i] = i < 5 }) // 처음 5개 자동 펼침
    return init
  })

  function toggleFile(idx: number) {
    setExpanded(prev => ({ ...prev, [idx]: !prev[idx] }))
  }

  function expandAll() {
    const all: Record<number, boolean> = {}
    changes.forEach((_, i) => { all[i] = true })
    setExpanded(all)
  }

  function collapseAll() {
    const all: Record<number, boolean> = {}
    changes.forEach((_, i) => { all[i] = false })
    setExpanded(all)
  }

  return (
    <div className="space-y-3">
      {changes.length > 1 && (
        <div className="flex justify-end gap-2 px-1">
          <button onClick={expandAll} className="text-xs text-ive-text-muted hover:text-ive-text transition-colors">
            <i className="fa-solid fa-angles-down mr-1" />모두 펼치기
          </button>
          <button onClick={collapseAll} className="text-xs text-ive-text-muted hover:text-ive-text transition-colors">
            <i className="fa-solid fa-angles-up mr-1" />모두 접기
          </button>
        </div>
      )}

      {changes.map((change, idx) => {
        const { added, removed } = countChanges(change.diff)
        const isOpen = expanded[idx] ?? false
        const diffLines = isOpen ? parseDiff(change.diff) : []
        const filePath = change.renamed_file
          ? `${change.old_path} → ${change.new_path}`
          : change.new_path

        return (
          <div key={idx} className="bg-ive-bg-card rounded-lg border border-ive-border-subtle overflow-hidden">
            {/* 파일 헤더 */}
            <button
              onClick={() => toggleFile(idx)}
              className="w-full px-3 py-2.5 flex items-center gap-2 text-left hover:bg-ive-bg-deep/50 transition-colors"
            >
              <i className={`fa-solid fa-chevron-${isOpen ? 'down' : 'right'} text-xs text-ive-text-dim w-3`} />
              <span className="text-sm font-mono text-ive-text flex-1 break-all">{filePath}</span>
              <FileLabel change={change} />
              {added > 0 && <span className="text-xs text-ive-green font-bold">+{added}</span>}
              {removed > 0 && <span className="text-xs text-ive-red font-bold">-{removed}</span>}
            </button>

            {/* Diff 내용 */}
            {isOpen && (
              <div className="border-t border-ive-border-dark overflow-x-auto">
                <table className="w-full text-xs font-mono leading-5">
                  <tbody>
                    {diffLines.map((line, i) => {
                      if (line.type === 'header') {
                        return (
                          <tr key={i} className="bg-ive-cyan/5">
                            <td colSpan={3} className="px-3 py-1 text-ive-cyan/70 select-none">
                              {line.content}
                            </td>
                          </tr>
                        )
                      }

                      const bgClass =
                        line.type === 'add' ? 'bg-ive-green/10' :
                        line.type === 'del' ? 'bg-ive-red/10' : ''
                      const textClass =
                        line.type === 'add' ? 'text-ive-green' :
                        line.type === 'del' ? 'text-ive-red' : 'text-ive-text'
                      const prefix =
                        line.type === 'add' ? '+' :
                        line.type === 'del' ? '-' : ' '
                      const lineNum = line.type === 'del' ? line.oldLine : line.newLine

                      return (
                        <tr key={i} className={bgClass}>
                          <td className="w-10 text-right pr-2 text-ive-text-muted/50 select-none border-r border-ive-border-dark/50">
                            {lineNum ?? ''}
                          </td>
                          <td className={`w-4 text-center select-none ${textClass}`}>
                            {prefix}
                          </td>
                          <td className={`px-2 whitespace-pre ${textClass}`}>
                            {line.content}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
