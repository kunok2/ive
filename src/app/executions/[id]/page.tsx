'use client'

import { use } from 'react'
import ExecutionTraceView from '@/components/execution/ExecutionTraceView'

export default function ExecutionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <ExecutionTraceView id={id} />
}
