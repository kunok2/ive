'use client'

import { useTranslations } from 'next-intl'
import { useStore } from '@/lib/store'
import { formatTime } from '@/lib/format-date'
import MarkdownNote from '@/components/ui/MarkdownNote'
import AgentAvatar from '@/components/agent/AgentAvatar'
import ElapsedTimer from './ElapsedTimer'

interface ChatMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

interface ChatMessagesProps {
  mode: 'comment' | 'chat'
  chatSessionId: string | null
  chatHistoryOnly: boolean
  chatMessages: ChatMessage[]
  chatAgentName: string | null
  chatAgentAvatar: string | null
  chatSending: boolean
  chatSendingStartTime: number | null
  chatStreamText: string
  iid: string
}

export default function ChatMessages({
  mode, chatSessionId, chatHistoryOnly, chatMessages, chatAgentName, chatAgentAvatar,
  chatSending, chatSendingStartTime, chatStreamText, iid,
}: ChatMessagesProps) {
  const { state } = useStore()
  const tIssue = useTranslations('issue')

  if (mode !== 'chat' || (!chatSessionId && !chatHistoryOnly)) return null

  return (
    <>
      <div className="flex items-center gap-2 my-2">
        <div className="flex-1 border-t border-ive-cyan/30" />
        <span className="text-xs font-bold text-ive-cyan uppercase tracking-widest">
          <i className="fa-solid fa-comments mr-1" />{tIssue('chatMode')}
        </span>
        <div className="flex-1 border-t border-ive-cyan/30" />
      </div>

      {/* Agent greeting */}
      <div className="flex items-start gap-2">
        <div className="shrink-0 mt-0.5">
          <AgentAvatar avatar={chatAgentAvatar || 'av-01'} size="sm" />
        </div>
        <div className="flex-1 rounded-lg px-3 py-2 bg-ive-cyan/5 border border-ive-cyan/15">
          <div className="text-xs font-bold text-ive-cyan mb-1">{chatAgentName || 'AI'}</div>
          <div className="text-sm leading-relaxed text-ive-text-muted">
            {tIssue('chatGreeting', { agent: chatAgentName || 'AI', iid: iid })}
          </div>
        </div>
      </div>

      {chatMessages.map(msg => (
        <div key={msg.id} className={`flex ${msg.role === 'user' ? 'flex-row-reverse' : ''} items-start gap-2`}>
          <div className="shrink-0 mt-0.5">
            {msg.role === 'user' ? (
              <AgentAvatar avatar={state.user?.avatar || 'av-01'} userId={state.user?.id} size="sm" />
            ) : (
              <AgentAvatar avatar={chatAgentAvatar || 'av-01'} size="sm" />
            )}
          </div>
          <div className={`rounded-lg px-3 py-2 ${msg.role === 'user' ? 'max-w-[80%]' : 'flex-1'} ${
            msg.role === 'user'
              ? 'bg-white/5 border border-ive-border-subtle'
              : 'bg-ive-bg-card border border-ive-cyan/15'
          }`}>
            <div className={`flex items-center gap-2 mb-1 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <span className={`text-xs font-bold ${
                msg.role === 'user' ? 'text-ive-text' : 'text-ive-cyan'
              }`}>
                {msg.role === 'user' ? (state.user?.name || 'You') : (chatAgentName || 'AI')}
              </span>
              <span className="text-xs text-ive-text-dim">
                {formatTime(msg.createdAt, state.user?.locale, state.user?.timezone)}
              </span>
            </div>
            <div className={`text-sm leading-relaxed break-words text-ive-text-muted ${msg.role === 'user' ? 'text-right' : ''}`}>
              <MarkdownNote body={msg.content} />
            </div>
          </div>
        </div>
      ))}

      {/* Streaming indicator */}
      {chatSending && chatStreamText && (
        <div className="flex items-start gap-2">
          <div className="shrink-0 mt-0.5">
            <AgentAvatar avatar={chatAgentAvatar || 'av-01'} size="sm" />
          </div>
          <div className="flex-1 rounded-lg px-3 py-2 bg-ive-bg-card border border-ive-cyan/15">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold text-ive-cyan">
                {chatAgentName || 'AI'}
                <i className="fa-solid fa-circle-notch fa-spin ml-1.5 text-xs" />
              </span>
              <ElapsedTimer startTime={chatSendingStartTime} />
            </div>
            <div className="text-sm leading-relaxed break-words text-ive-text-muted">
              <MarkdownNote body={chatStreamText} />
            </div>
          </div>
        </div>
      )}
      {chatSending && !chatStreamText && (
        <div className="flex items-center gap-2 py-3">
          <div className="shrink-0">
            <AgentAvatar avatar={chatAgentAvatar || 'av-01'} size="sm" />
          </div>
          <ElapsedTimer startTime={chatSendingStartTime} />
        </div>
      )}
    </>
  )
}
