import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getExecution } from '@/lib/db';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const executionId = params.id;
  const execution = getExecution(executionId);

  if (!execution || !fs.existsSync(execution.logPath)) {
    return new Response('Log not found', { status: 404 });
  }

  const logPath = execution.logPath;

  const stream = new ReadableStream({
    start(controller) {
      const stats = fs.statSync(logPath);
      let position = 0;

      // 먼저 기존 내용을 다 보냄
      const initialContent = fs.readFileSync(logPath);
      controller.enqueue(new TextEncoder().encode(initialContent.toString()));
      position = stats.size;

      // 파일 변화 감시
      const watcher = fs.watch(logPath, (eventType) => {
        if (eventType === 'change') {
          const currentStats = fs.statSync(logPath);
          if (currentStats.size > position) {
            const fd = fs.openSync(logPath, 'r');
            const buffer = Buffer.alloc(currentStats.size - position);
            fs.readSync(fd, buffer, 0, buffer.length, position);
            fs.closeSync(fd);
            
            controller.enqueue(new TextEncoder().encode(buffer.toString()));
            position = currentStats.size;
          }
        }
      });

      // 만약 작업이 종료되었다면 (status가 running이 아니라면) 일정 시간 후 종료
      const checkStatus = setInterval(() => {
        const currentExecution = getExecution(executionId);
        if (currentExecution && currentExecution.status !== 'running') {
          // 마지막으로 기록된 내용이 있을 수 있으니 조금 대기 후 닫음
          setTimeout(() => {
            watcher.close();
            clearInterval(checkStatus);
            controller.close();
          }, 2000);
        }
      }, 5000);

      req.signal.addEventListener('abort', () => {
        watcher.close();
        clearInterval(checkStatus);
        controller.close();
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
