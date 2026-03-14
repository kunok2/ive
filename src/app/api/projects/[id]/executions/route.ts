import { NextRequest, NextResponse } from 'next/server';
import { getLatestExecutionsByProject } from '@/lib/db';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const projectId = params.id;
  try {
    const executions = getLatestExecutionsByProject(projectId);
    return NextResponse.json(executions);
  } catch (err) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
