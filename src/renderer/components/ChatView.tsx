import { useEffect, useMemo, useRef, useState } from "react"
import { Gauge, Sparkles } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { ChatMessage } from "../../shared/types"
import { createChatStreamStore } from "../../shared/chat-stream-store"
import { useChatStreamStore } from "../stores/use-chat-stream-store"
import { useChatStreamBridge } from "../hooks/use-chat-stream-bridge"
import { MessageBubble } from "./MessageBubble"
import { MessageInput } from "./MessageInput"
import { ApprovalCard } from "./ApprovalCard"
import { PatchPreviewCard, type PatchRecord } from "./PatchPreviewCard"

const MODES = ["ask", "suggest", "auto", "fullAuto"] as const
type ModeKey = (typeof MODES)[number]

/**
 * ChatView — 流式聊天视图（渲染端消费接线集成点）
 *
 * 每会话一个 store（useMemo 按 sessionId 建实例），bridge 订阅主进程
 * chat-stream-* 通道并派发进 store；useChatStreamStore 读快照驱动 UI。
 * 挂载时经 window.dave.session.get 补拉真实会话历史（无结果则空态引导）。
 * 流结束后 finalContent 落为常驻消息。状态区带 aria-live 播报。
 */
export function ChatView({
  sessionId,
  title,
  initialMessages = [],
  onTitleUpdate,
}: {
  sessionId: string
  title?: string
  initialMessages?: ChatMessage[]
  /** 会话标题变更通知（用于自动命名后刷新侧栏） */
  onTitleUpdate?: (sessionId: string, title: string) => void
}) {
  const { t } = useTranslation()
  const [history, setHistory] = useState<ChatMessage[]>(initialMessages)
  const [hydrated, setHydrated] = useState(false)
  const [mode, setMode] = useState<ModeKey>("ask")
  const store = useMemo(() => createChatStreamStore(), [sessionId])
  const state = useChatStreamStore(store)
  const scrollRef = useRef<HTMLDivElement>(null)
  const doneSeededRef = useRef<string | null>(null)
  const titledRef = useRef(false)
  const patchesRef = useRef<PatchRecord[]>([])

  // patch（diff 独立载体）经 bridge onEvent 收集，流结束后聚合为文件变更卡
  const bridge = useChatStreamBridge(store, sessionId, (event) => {
    if (event.type === "patch" && event.patch) {
      const paths = "paths" in event ? (event.paths ?? []) : []
      patchesRef.current.push({ diff: event.patch, paths })
    }
  })

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [history, state])

  // 补拉真实会话历史（仅当本地无预填且 preload 可用）
  useEffect(() => {
    let cancelled = false
    if (hydrated || history.length > 0 || !window.dave?.session) {
      setHydrated(true)
      return
    }
    ;(async () => {
      try {
        const data = await window.dave.session.get(sessionId)
        if (!cancelled && data?.messages?.length) {
          setHistory((prev) => (prev.length ? prev : data.messages))
        }
      } catch {
        /* 会话不存在（新对话/未持久化）→ 保持空态 */
      } finally {
        if (!cancelled) setHydrated(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId, hydrated, history.length])

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
  const empty = history.length === 0 && state.status !== "streaming" && !busy

  // 初始读取模式（主进程持久化）
  useEffect(() => {
    window.dave?.store
      ?.get("mode")
      .then((m) => {
        if (m && (MODES as readonly string[]).includes(m)) setMode(m as ModeKey)
      })
      .catch(() => {})
  }, [])

  // 模式循环切换：提问 → 建议 → 自动 → 全自动
  const cycleMode = async () => {
    const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length]
    setMode(next)
    try {
      await window.dave.store.set("mode", next)
    } catch {
      /* 主进程不可用时仅本地切换 */
    }
  }

  // Esc 中止流式输出（流式/工具/审批均视为 busy）
  useEffect(() => {
    if (!busy) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") bridge.abort()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [busy, bridge])

  const handleSend = (text: string) => {
    setHistory((prev) => [...prev, { role: "user", content: text }])
    // 首条消息自动命名（截断 36 字，避免标题无限增长）
    if (!titledRef.current) {
      titledRef.current = true
      const idea = text.slice(0, 36)
      if (window.dave?.session) {
        void window.dave.session.updateTitle(sessionId, idea)
      }
      onTitleUpdate?.(sessionId, idea)
    }
    if (window.dave?.chat) {
      void window.dave.chat.stream(text, sessionId)
    }
  }

  return (
    <section className="relative flex h-full min-w-0 flex-col bg-[var(--bg)]">
      <header className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-[var(--line)] bg-[var(--bg)]/80 px-4 backdrop-blur">
        <h1 className="truncate text-sm font-semibold text-[var(--ink)]">
          {title || t("common.sessions")} · {sessionId}
        </h1>
        <button
          onClick={() => void cycleMode()}
          title={t("common.mode")}
          aria-label={t("common.mode")}
          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--amber-600)]/40 bg-[var(--amber-50)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--amber-600)] transition-transform hover:bg-[var(--amber-500)]/15 active:scale-95"
        >
          <Gauge size={12} strokeWidth={2.2} />
          {t(`mode.${mode}`)}
        </button>
        <span
          role="status"
          aria-live="polite"
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
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

          {state.status === "done" && patchesRef.current.length > 0 && (
            <PatchPreviewCard patches={patchesRef.current} />
          )}

          {state.status === "error" && (
            <div
              role="alert"
              className="self-start rounded-lg bg-[var(--err-bg)] px-3.5 py-2.5 text-[13px] text-[#8f2f22]"
            >
              {state.error}
            </div>
          )}

          {empty && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--amber-50)] text-[var(--amber-600)]">
                <Sparkles size={20} strokeWidth={1.8} />
              </div>
              <p className="text-[13.5px] leading-relaxed text-[var(--ink-2)]">
                {t("common.newChat")}
                <br />
                {t("chat.placeholder")}
              </p>
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