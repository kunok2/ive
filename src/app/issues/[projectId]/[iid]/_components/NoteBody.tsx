'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import MarkdownNote, { cleanNoteBody } from '@/components/ui/MarkdownNote'

export default function NoteBody({ body, projectId }: { body: string; projectId?: string }) {
  const [expanded, setExpanded] = useState(false)
  const tc = useTranslations('common')
  const tIssue = useTranslations('issue')
  const cleaned = cleanNoteBody(body)
  const display = expanded ? cleaned : cleaned.slice(0, 500) + '...'
  return (
    <>
      <MarkdownNote body={display} projectId={projectId} />
      <button
        onClick={() => setExpanded(!expanded)}
        className="block mt-1 text-xs text-ive-green hover:underline"
      >
        {expanded ? tc('collapse') : tIssue('viewAll')}
      </button>
    </>
  )
}
