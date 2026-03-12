import { NextResponse } from 'next/server'
import { updateSlot, deleteSlot } from '@/lib/db'

export async function PUT(req: Request, { params }: { params: Promise<{ id: string; slotId: string }> }) {
  const { id, slotId } = await params
  const body = await req.json()
  updateSlot({ ...body, id: slotId, projectId: id })
  return NextResponse.json({ ...body, id: slotId, projectId: id })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ slotId: string }> }) {
  const { slotId } = await params
  deleteSlot(slotId)
  return NextResponse.json({ success: true })
}
