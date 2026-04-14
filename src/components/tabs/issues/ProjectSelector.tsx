'use client'

import { useState, useRef, useEffect } from 'react'
import { useTranslations } from 'next-intl'

interface Project {
  id: string
  name: string
  [key: string]: any
}

interface ProjectSelectorProps {
  projects: Project[]
  selectedProjectId: string
  onSelectProject: (id: string) => void
}

export default function ProjectSelector({ projects, selectedProjectId, onSelectProject }: ProjectSelectorProps) {
  const tProject = useTranslations('project')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (projects.length <= 1) return null

  const selectedProject = projects.find(p => p.id === selectedProjectId)

  return (
    <div ref={ref} className="relative mb-3">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full appearance-none bg-none bg-ive-bg-card border border-ive-border-subtle rounded-lg px-4 py-3 text-left flex items-center justify-between focus:outline-none focus:border-ive-green/50 transition-colors"
      >
        <span className={`text-base font-bold ${selectedProjectId ? 'text-ive-text' : 'text-ive-text-dim'}`}>
          {selectedProject?.name || tProject('selectProject')}
        </span>
        <i className={`fa-solid fa-chevron-down text-xs text-ive-text-dim transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          className="absolute z-50 top-full left-0 right-0 mt-1 border border-ive-border-subtle rounded-lg overflow-hidden shadow-lg"
          style={{ backgroundColor: '#1c1c20' }}
        >
          {projects.map(p => (
            <button
              key={p.id}
              onClick={() => { onSelectProject(p.id); setOpen(false) }}
              className={`w-full px-4 py-3 text-left text-base font-bold transition-colors ${
                p.id === selectedProjectId
                  ? 'bg-ive-cyan/10 text-ive-cyan'
                  : 'text-ive-text hover:bg-white/5'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
