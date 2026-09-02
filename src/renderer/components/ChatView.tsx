import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { ChatMessage } from "../../shared/types"
import { createChatStreamStore } from "../../shared/chat-stream-store"
import { useChatStreamStore } from "../stores/use-chat-stream-store"
import { useChatStreamBridge } from "../hooks/use-chat-stream-bridge"
import { MessageBubble } from "./MessageBubble"
import { MessageInput } from "./MessageInput"
import { ApprovalCard } from "./ApprovalCard"

/**
 * ChatView — 流式聊天视图（渲染端消费接线集成点）
 *
 * 每会话一个 store（useMemo 按 sessionId 建实例），bridge 订阅主进程
 * chat-stream-* 通道并派发进 store；useChatStreamStore 读快照驱动 UI：
 *   streaming → 流式文本 + 光标；tool_pending → 正在执行工具；
 *   approval_pending → ApprovalCard（允许/拒绝 → bridge.approve 同步主进程+推进状态机）；
 *   done/aborted → 保留部分输出；error → 错误提示。
 * 发送走 window.dave.chat.stream；纯浏览器预览（无 preload）时仅本地上屏。
 */
export function ChatView({ sessionId, initialMessages = [] }: { sessionId: string; initialMessages?: ChatMessage[] }) {
  const { t } = useTranslation()
  const [history, setHistory] = useState<ChatMessage[]>(initialMessages)
  const store = useMemo(() => createChatStreamStore(), [sessionId])
  const state = useChatStreamStore(store)
  const bridge = useChatStreamBridge(store, sessionId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const doneSeededRef = useRef<string | null>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [history, state])

  // 流结束后把最终文本落成常驻消息（done/aborted 均含 finalContent）
  useEffect(() => {
    if (state.status === "done") {
      const content = state.finalContent
      if (content && doneSeededRef.current !== content) {
        doneSeededRef.current = content
        setHistory((prev) => [...prev, { role: "assistant", content }])
      }
    }
  }, [state])

  const busy = state.status === "streaming" || state.status === "tool_pending" || state.status === "approval_pending"

  const handleSend = (text: string) => {
    setHistory((prev) => [...prev, { role: "user", content: text }])
    if (window.dave?.chat) {
      void window.dave.chat.stream(text, sessionId)
    }
  }

  return (
    <section className="relative flex h-full min-w-0 flex-col bg-[var(--bg)]">
      <header className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-[var(--line)] bg-[var(--bg)]/80 px-4 backdrop-blur">
        <span className="truncate text-sm font-semibold">{t("common.sessions")} · {sessionId}</span>
        <span
          className={`ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
            busy ? "bg-[var(--amber-50)] text-[var(--amber-600)]" : "bg-[var(--ok-bg)] text-[var(--ok)]"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${busy ? "animate-pulse bg-[var(--amber-600)]" : "bg-[var(--ok)]"}`} />
          {busy ? t("chat.streaming") : t("chat.done")}
        </span>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pb-24">
        <div className="mx-auto flex max-w-[720px] flex-col gap-4 px-5 py-4">
          {history.map((m, i) => (
            <MessageBubble key={i} role={m.role} content={m.content} />
          ))}

          {state.status === "streaming" && state.content.length > 0 && (
            <MessageBubble role="assistant" content={state.content} streaming />
          )}

          {state.status === "tool_pending" && (
            <div className="flex items-center gap-2 self-start rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[12.5px] text-[var(--ink-2)]">
              <span className="font-mono">{t("tool.running")}:</span>
              <span className="font-mono text-[var(--amber-700)]">{state.tools.join("、")}</span>
            </div>
          )}

          {state.status === "approval_pending" && (
            <ApprovalCard
              tool={state.tool}
              args={state.toolArgs}
              mutates={state.mutates}
              isShell={state.isShell}
              onDecision={(v) => bridge.approve(v)}
            />
          )}

          {state.status === "done" && state.aborted && state.finalContent.length > 0 && (
            <MessageBubble role="assistant" content={state.finalContent} aborted />
          )}

          {state.status === "error" && (
            <div className="self-start rounded-lg bg-[var(--err-bg)] px-3.5 py-2.5 text-[13px] text-[#8f2f22]">
              {state.error}
            </div>
          )}
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0">
        <MessageInput streaming={busy} onSend={handleSend} onStop={bridge.abort} />
      </div>
    </section>
  )
}