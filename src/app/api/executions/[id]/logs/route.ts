import { NextRequest } from 'next/server';
import fs from 'fs';
import { getExecution } from '@/lib/db';

function toSSE(text: string): string {
  if (!text) return ''
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  if (lines.length === 0) return ''
  return lines.map(line => `data: ${line}`).join('\n') + '\n\n'
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: executionId } = await params;
  const execution = getExecution(executionId);

  if (!execution || !fs.existsSync(execution.logPath)) {
    return new Response('data: [SYSTEM] Log file not found.\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
  }

  const logPath = execution.logPath;
  const skipInitial = req.nextUrl.searchParams.get('skipInitial') === '1';

  const stream = new ReadableStream({
    start(controller) {
      let position = 0;

      if (!skipInitial) {
        // 기존 내용 전송
        const initialContent = fs.readFileSync(logPath, 'utf-8');
        if (initialContent) {
          controller.enqueue(new TextEncoder().encode(toSSE(initialContent)));
        }
      }
      position = fs.statSync(logPath).size;

      // 완료된 실행은 즉시 종료
      if (execution.status !== 'running') {
        controller.close();
        return;
      }

      // 실행 중: 500ms 폴링으로 새 내용 감시 (fs.watch는 macOS에서 불안정)
      const poll = setInterval(() => {
        try {
          const currentSize = fs.statSync(logPath).size;
          if (currentSize > position) {
            const fd = fs.openSync(logPath, 'r');
            const buffer = Buffer.alloc(currentSize - position);
            fs.readSync(fd, buffer, 0, buffer.length, position);
            fs.closeSync(fd);
            position = currentSize;
            controller.enqueue(new TextEncoder().encode(toSSE(buffer.toString('utf-8'))));
          }

          // 실행 완료 확인
          const cur = getExecution(executionId);
          if (cur && cur.status !== 'running') {
            setTimeout(() => {
              clearInterval(poll);
              try { controller.close(); } catch { /* ignore */ }
            }, 2000);
          }
        } catch { /* ignore */ }
      }, 500);

      req.signal.addEventListener('abort', () => {
        clearInterval(poll);
        try { controller.close(); } catch { /* ignore */ }
      });
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
