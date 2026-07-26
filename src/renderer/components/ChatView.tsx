import { useState, useRef, useEffect, useMemo, useCallback } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { MessageList } from "./MessageList"
import { MessageInput } from "./MessageInput"
import { EmptyStateTemplates } from "./EmptyStateTemplates"
import type { Mode } from "../App"
import type { ChatMessage } from "../../shared/types"
import { DEFAULT_CONTEXT_TOKEN_BUDGET } from "../../shared/types"
import { estimateMessageTokensRough } from "../../shared/context"
import { messagesToMarkdown } from "../../shared/export"
import { ChevronDown, Bot, Folder, Download } from "lucide-react"

interface ChatViewProps {
  mode: Mode
  onModeChange: (m: Mode) => void
  messages: ChatMessage[]
  streamingContent: string
  isStreaming: boolean
  error: string | null
  onSendMessage: (content: string) => void
  onAbort: () => void
  onRegenerate?: (userContent: string) => void
  workspace?: string
  sessionId?: string | null
  sessionTitle?: string
  insertSnippet?: string | null
  onInsertConsumed?: () => void
}

const modes: Mode[] = ["ask", "suggest", "auto", "full-auto"]
const modeLabel: Record<Mode, string> = {
  ask: "询问",
  suggest: "建议",
  auto: "自动",
  "full-auto": "全自动",
}
const modeDesc: Record<Mode, string> = {
  ask: "只回答，不改文件",
  suggest: "出 diff，批准后写入",
  auto: "可读写文件，shell 需批准",
  "full-auto": "读写 + shell；高危 shell 仍确认",
}

export function ChatView({
  mode,
  onModeChange,
  messages,
  streamingContent,
  isStreaming,
  error,
  onSendMessage,
  onAbort,
  onRegenerate,
  workspace = "",
  sessionId,
  sessionTitle,
  insertSnippet,
  onInsertConsumed,
}: ChatViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const modeMenuRef = useRef<HTMLDivElement>(null)
  const [modeOpen, setModeOpen] = useState(false)
  const [didInitialScroll, setDidInitialScroll] = useState(false)

  // 虚拟列表:tanstack-virtual v3.14.2 原生 chat 支持。
  // anchorTo:'end' 固定到底部, followOnAppend 在用户阅读历史时不移位,
  // streaming 内容增长时自动调整偏移以保持底部固定。
  const streamingExtra = isStreaming ? 1 : 0
  const virtualizer = useVirtualizer({
    count: messages.length + streamingExtra,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72,
    getItemKey: useCallback(
      (index: number) => {
        if (index < messages.length) {
          const m = messages[index]
          return `${m.role}-${index}-${m.content.length}-${m.name ?? ""}-${m.tool_call_id ?? ""}`
        }
        return "streaming"
      },
      [messages],
    ),
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: 80,
    overscan: 6,
  })

  // 首次加载时滚到底部
  useEffect(() => {
    if (didInitialScroll) return
    if (messages.length > 0 || isStreaming) {
      virtualizer.scrollToEnd()
      setDidInitialScroll(true)
    }
  }, [didInitialScroll, messages.length, isStreaming, virtualizer])

  // 模式菜单打开时:点外部 / Esc 关闭。
  useEffect(() => {
    if (!modeOpen) return
    const onDown = (e: MouseEvent) => {
      const m = modeMenuRef.current
      const trigger = (e.target as HTMLElement)?.closest?.("[data-mode-trigger]")
      if (m && m.contains(e.target as Node)) return
      if (trigger) return
      setModeOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        setModeOpen(false)
      }
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [modeOpen])

  const scrollToBottom = useCallback(() => {
    virtualizer.scrollToEnd({ behavior: "smooth" })
  }, [virtualizer])

  const atBottom = messages.length > 0 || isStreaming ? virtualizer.isAtEnd(80) : true

  const shortWs = workspace
    ? workspace.replace(/\\/g, "/").split("/").filter(Boolean).slice(-2).join("/")
    : ""

  const tokenCount = useMemo(() => {
    let n = messages.reduce((s, m) => s + estimateMessageTokensRough(m), 0)
    if (streamingContent) {
      n += estimateMessageTokensRough({ role: "assistant", content: streamingContent })
    }
    return n
  }, [messages, streamingContent])

  const handleExport = useCallback(() => {
    const md = messagesToMarkdown(messages, {
      title: sessionTitle || "Dave session",
      sessionId: sessionId || undefined,
    })
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${(sessionTitle || "session").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40)}.md`
    a.click()
    URL.revokeObjectURL(url)
  }, [messages, sessionId, sessionTitle])

  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="relative flex items-center justify-between px-3 py-1.5 border-b border-[var(--border)] bg-[var(--bg-panel)]">
        <button
          data-mode-trigger
          onClick={() => setModeOpen(!modeOpen)}
          className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-[var(--text)] hover:bg-[var(--bg-active)] transition-colors"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
          <span>
            模式 · <span className="text-[var(--text-strong)] font-medium">{modeLabel[mode]}</span>
          </span>
          <ChevronDown size={12} className={modeOpen ? "rotate-180" : ""} />
        </button>
        <div className="flex items-center gap-3 text-[11px] text-[var(--text-dim)]">
          {shortWs && (
            <span className="flex items-center gap-1 max-w-[12rem] truncate" title={workspace}>
              <Folder size={11} />
              {shortWs}
            </span>
          )}
          <span title={`约 ${tokenCount} tokens`}>
            ~{tokenCount < 1000 ? tokenCount : `${Math.round(tokenCount / 1000)}k`} tok
          </span>
          <span>{messages.length} 条</span>
          <button
            type="button"
            className="btn-icon-muted !p-1"
            title="导出 Markdown"
            aria-label="导出 Markdown"
            disabled={messages.length === 0}
            onClick={handleExport}
          >
            <Download size={13} />
          </button>
          {isStreaming && (
            <span
              className="flex items-center gap-1 text-[var(--accent)]"
              role="status"
              aria-live="polite"
              aria-label="生成中"
            >
              <span className="spinner" aria-hidden="true" /> 生成中
            </span>
          )}
        </div>
        {modeOpen && (
          <div
            ref={modeMenuRef}
            className="absolute left-2 top-full mt-1 w-64 bg-[var(--bg-panel)] border border-[var(--border)] rounded-md shadow-md z-50 overflow-hidden"
          >
            {modes.map((m) => (
              <button
                key={m}
                onClick={() => {
                  onModeChange(m)
                  setModeOpen(false)
                }}
                className={`w-full text-left px-3 py-2 hover:bg-[var(--bg-active)] transition-colors ${
                  m === mode ? "bg-[var(--accent-soft)]" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--text-strong)]">
                    {modeLabel[m]}
                  </span>
                  {m === mode && <span className="text-[10px] text-[var(--accent)]">当前</span>}
                </div>
                <div className="text-[11px] text-[var(--text-dim)] mt-0.5">{modeDesc[m]}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-[var(--bg)] relative">
        {messages.length === 0 && !isStreaming ? (
          <div className="flex flex-col items-center px-6 py-10 h-full overflow-y-auto">
            <div className="empty-state flex-shrink-0">
              <div className="empty-state-icon">
                <Bot size={20} />
              </div>
              <h2 className="empty-state-title">开始对话</h2>
              <p className="empty-state-desc">
                当前模式 · <span className="text-[var(--text-strong)]">{modeLabel[mode]}</span>
                {" · "}
                {modeDesc[mode]}
              </p>
              <div className="empty-state-meta">
                <span className="chip">Enter 发送</span>
                <span className="chip">@path</span>
                <span className="chip">Cmd+K 命令</span>
                <span className="chip">? 快捷键</span>
                <span className="chip">
                  ~{Math.round(DEFAULT_CONTEXT_TOKEN_BUDGET / 1000)}k 上下文
                </span>
              </div>
            </div>
            <EmptyStateTemplates
              hasWorkspace={!!workspace}
              onPick={(prompt) => onSendMessage(prompt)}
            />
          </div>
        ) : (
          <div
            ref={virtualizer.containerRef}
            style={{
              position: "relative",
              width: "100%",
              height: virtualizer.getTotalSize(),
            }}
          >
            <MessageList
              messages={messages}
              streamingContent={streamingContent}
              isStreaming={isStreaming}
              onStop={onAbort}
              onRegenerate={onRegenerate}
              virtualItems={virtualItems}
              virtualizer={virtualizer}
            />
          </div>
        )}
        {error && (
          <div
            className="mx-3 mb-2 p-2.5 bg-[var(--diff-del-bg)] border border-[rgba(207,34,46,0.35)] rounded text-xs text-[var(--diff-del)]"
            role="alert"
            aria-live="assertive"
          >
            <strong>错误</strong> · {error}
          </div>
        )}
        {!atBottom && (messages.length > 0 || isStreaming) && (
          <button
            type="button"
            className="scroll-bottom-btn"
            onClick={scrollToBottom}
            title="滚到底部"
            aria-label="滚到底部"
          >
            <ChevronDown size={16} />
          </button>
        )}
      </div>

      <MessageInput
        onSend={onSendMessage}
        onAbort={onAbort}
        disabled={isStreaming}
        mode={mode}
        modeLabel={modeLabel[mode]}
        insertSnippet={insertSnippet}
        onInsertConsumed={onInsertConsumed}
      />
    </div>
  )
}
