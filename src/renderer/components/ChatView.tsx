import { useState, useRef, useEffect, useMemo, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { useVirtualizer } from "@tanstack/react-virtual"
import { MessageList } from "./MessageList"
import { MessageInput } from "./MessageInput"
import { EmptyStateTemplates } from "./EmptyStateTemplates"
import type { Mode } from "../App"
import type { ChatMessage } from "../../shared/types"
import { DEFAULT_CONTEXT_TOKEN_BUDGET } from "../../shared/types"
import { estimateMessageTokensRough } from "../../shared/context"
import { messagesToMarkdown } from "../../shared/export"
import {
  findAdjacentAssistantIndex,
  findMessageMatchIndices,
  stepMatchIndex,
} from "../../shared/message-search"
import { ChevronDown, Bot, Folder, Download, Gauge, Search, X, ChevronUp } from "lucide-react"
import type { FpsMonitor } from "../lib/fps-monitor"
import { useStore } from "../stores/useStore"

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
  onEditUserMessage?: (index: number, newContent: string) => void
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
  "full-auto": "自动读写文件；所有 shell 均需确认",
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
  onEditUserMessage,
  workspace = "",
  sessionId,
  sessionTitle,
  insertSnippet,
  onInsertConsumed,
}: ChatViewProps) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const modeMenuRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [modeOpen, setModeOpen] = useState(false)
  const [didInitialScroll, setDidInitialScroll] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [activeSearchIndex, setActiveSearchIndex] = useState<number | null>(null)
  const [navCursor, setNavCursor] = useState<number | null>(null)

  // 性能测试（仅 dev 模式）
  const fpsMonitorRef = useRef<FpsMonitor | null>(null)
  const perfOriginalMessagesRef = useRef<ChatMessage[] | null>(null)
  const perfSessionIdRef = useRef<string | null | undefined>(null)
  const currentSessionIdRef = useRef(sessionId)
  currentSessionIdRef.current = sessionId
  const perfStartingRef = useRef(false)
  const mountedRef = useRef(true)
  const [perfTestRunning, setPerfTestRunning] = useState(false)

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

  const stopPerfTest = useCallback(() => {
    if (fpsMonitorRef.current) {
      fpsMonitorRef.current.stop()
      fpsMonitorRef.current.printReport("Virtual Scroll Performance")
      fpsMonitorRef.current = null
    }
    if (perfOriginalMessagesRef.current && perfSessionIdRef.current === sessionId) {
      useStore.getState().setMessages(perfOriginalMessagesRef.current)
      setDidInitialScroll(false)
    }
    perfOriginalMessagesRef.current = null
    perfSessionIdRef.current = null
    perfStartingRef.current = false
    setPerfTestRunning(false)
  }, [sessionId])

  // 性能测试仅在开发环境按需加载，生产构建不会包含生成器和 FPS 实现。
  const handlePerfTest = useCallback(async () => {
    if (!import.meta.env.DEV || perfStartingRef.current) return
    if (perfTestRunning) {
      stopPerfTest()
      return
    }

    perfStartingRef.current = true
    const startSessionId = sessionId
    const { createVirtualScrollTest } = await import("../lib/performance-test")
    if (!mountedRef.current || startSessionId !== currentSessionIdRef.current) {
      perfStartingRef.current = false
      return
    }
    const test = createVirtualScrollTest(2000)
    perfOriginalMessagesRef.current = useStore.getState().messages
    perfSessionIdRef.current = sessionId
    useStore.getState().setMessages(test.messages)
    setDidInitialScroll(false)

    fpsMonitorRef.current = test.monitor
    test.monitor.start()
    perfStartingRef.current = false
    setPerfTestRunning(true)
    requestAnimationFrame(() => virtualizer.scrollToEnd())
    console.log(`已注入 ${test.messages.length} 条测试消息；滚动列表后再次点击仪表盘查看报告`)
  }, [perfTestRunning, sessionId, stopPerfTest, virtualizer])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      perfStartingRef.current = false
      if (fpsMonitorRef.current) {
        fpsMonitorRef.current.stop()
        fpsMonitorRef.current = null
      }
      if (perfOriginalMessagesRef.current && perfSessionIdRef.current === sessionId) {
        useStore.getState().setMessages(perfOriginalMessagesRef.current)
      }
      perfOriginalMessagesRef.current = null
      perfSessionIdRef.current = null
    }
  }, [sessionId])

  useEffect(() => {
    if (!perfTestRunning || perfSessionIdRef.current === sessionId) return
    if (fpsMonitorRef.current) {
      fpsMonitorRef.current.stop()
      fpsMonitorRef.current = null
    }
    perfOriginalMessagesRef.current = null
    perfSessionIdRef.current = null
    perfStartingRef.current = false
    setPerfTestRunning(false)
  }, [perfTestRunning, sessionId])

  const virtualItems = virtualizer.getVirtualItems()

  const searchHits = useMemo(
    () => findMessageMatchIndices(messages, searchQuery),
    [messages, searchQuery],
  )
  const searchHitSet = useMemo(() => new Set(searchHits), [searchHits])

  const scrollToMessage = useCallback(
    (index: number) => {
      virtualizer.scrollToIndex(index, { align: "center", behavior: "smooth" })
    },
    [virtualizer],
  )

  const goToSearchMatch = useCallback(
    (delta: 1 | -1) => {
      const next = stepMatchIndex(searchHits, activeSearchIndex, delta)
      if (next == null) return
      setActiveSearchIndex(next)
      setNavCursor(next)
      scrollToMessage(next)
    },
    [searchHits, activeSearchIndex, scrollToMessage],
  )

  const openSearch = useCallback(() => {
    setSearchOpen(true)
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchQuery("")
    setActiveSearchIndex(null)
    setNavCursor(null)
  }, [])

  // 查询变化时定位到第一处命中
  useEffect(() => {
    if (!searchOpen) return
    if (searchHits.length === 0) {
      setActiveSearchIndex(null)
      return
    }
    setActiveSearchIndex((prev) => {
      if (prev != null && searchHits.includes(prev)) return prev
      const first = searchHits[0]
      if (first == null) return null
      requestAnimationFrame(() => scrollToMessage(first))
      return first
    })
  }, [searchHits, searchOpen, scrollToMessage])

  // 会话切换时清搜索
  useEffect(() => {
    closeSearch()
    setNavCursor(null)
  }, [sessionId, closeSearch])

  // Ctrl+F 搜索；Ctrl+↑/↓ 跳转 assistant 消息
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault()
        if (searchOpen) {
          searchInputRef.current?.focus()
          searchInputRef.current?.select()
        } else {
          openSearch()
        }
        return
      }
      if (searchOpen && e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        closeSearch()
        return
      }
      if (searchOpen && e.key === "Enter" && !e.shiftKey) {
        // 搜索框内 Enter 在 onKeyDown 处理；此处兜底全局
        if (document.activeElement === searchInputRef.current) return
        e.preventDefault()
        goToSearchMatch(e.shiftKey ? -1 : 1)
        return
      }
      // Ctrl+↑/↓：上/下一条 assistant（输入框内不抢，除非同时按了 mod 且用户明确导航）
      if (mod && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        const target = e.target
        if (
          target instanceof HTMLElement &&
          (target.tagName === "TEXTAREA" || target.tagName === "INPUT") &&
          target !== searchInputRef.current
        ) {
          // 允许在 composer 里用 Ctrl+箭头导航历史 assistant
        }
        e.preventDefault()
        const dir = e.key === "ArrowUp" ? -1 : 1
        const from = navCursor ?? activeSearchIndex ?? (dir === -1 ? messages.length : -1)
        const next = findAdjacentAssistantIndex(messages, from, dir)
        if (next == null) return
        setNavCursor(next)
        setActiveSearchIndex(next)
        scrollToMessage(next)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [
    searchOpen,
    openSearch,
    closeSearch,
    goToSearchMatch,
    navCursor,
    activeSearchIndex,
    messages,
    scrollToMessage,
  ])

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
          <span>{t("settings.chat.messageCount", { count: messages.length })}</span>
          <button
            type="button"
            className={`btn-icon-muted !p-1 ${searchOpen ? "text-[var(--accent)]" : ""}`}
            title={t("settings.chat.searchMessages")}
            aria-label={t("settings.chat.searchMessages")}
            aria-pressed={searchOpen}
            onClick={() => (searchOpen ? closeSearch() : openSearch())}
          >
            <Search size={13} />
          </button>
          {import.meta.env.DEV && (
            <button
              type="button"
              className={`btn-icon-muted !p-1 ${perfTestRunning ? "text-[var(--accent)]" : ""}`}
              title={perfTestRunning ? "停止性能测试" : "性能测试（2000 消息）"}
              aria-label="性能测试"
              onClick={() => void handlePerfTest()}
            >
              <Gauge size={13} />
            </button>
          )}
          <button
            type="button"
            className="btn-icon-muted !p-1"
            title={t("settings.chat.exportMarkdown")}
            aria-label={t("settings.chat.exportMarkdown")}
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

      {searchOpen && (
        <div
          className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)] bg-[var(--bg-sunk)]"
          role="search"
          aria-label="消息全文搜索"
        >
          <Search size={12} className="text-[var(--text-faint)] shrink-0" />
          <input
            ref={searchInputRef}
            type="search"
            className="input flex-1 !py-1 !text-xs"
            placeholder="搜索当前会话消息…"
            value={searchQuery}
            aria-label="搜索关键词"
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                goToSearchMatch(e.shiftKey ? -1 : 1)
              }
              if (e.key === "Escape") {
                e.preventDefault()
                closeSearch()
              }
            }}
          />
          <span className="text-[10px] text-[var(--text-dim)] tabular-nums shrink-0 min-w-[3.5rem] text-right">
            {searchQuery.trim()
              ? searchHits.length === 0
                ? "无匹配"
                : `${
                    (searchHits.indexOf(activeSearchIndex ?? -1) >= 0
                      ? searchHits.indexOf(activeSearchIndex!)
                      : 0) + 1
                  }/${searchHits.length}`
              : "—"}
          </span>
          <button
            type="button"
            className="btn-icon-muted !p-1"
            title={t("settings.chat.prevOccurrence")}
            aria-label={t("settings.chat.prevOccurrence")}
            disabled={searchHits.length === 0}
            onClick={() => goToSearchMatch(-1)}
          >
            <ChevronUp size={13} />
          </button>
          <button
            type="button"
            className="btn-icon-muted !p-1"
            title={t("settings.chat.nextOccurrence")}
            aria-label={t("settings.chat.nextOccurrence")}
            disabled={searchHits.length === 0}
            onClick={() => goToSearchMatch(1)}
          >
            <ChevronDown size={13} />
          </button>
          <button
            type="button"
            className="btn-icon-muted !p-1"
            title="关闭搜索"
            aria-label="关闭搜索"
            onClick={closeSearch}
          >
            <X size={13} />
          </button>
        </div>
      )}

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
                <span className="chip">{t("settings.chat.enterSend")}</span>
                <span className="chip">@path</span>
                <span className="chip">{t("settings.chat.cmdK")}</span>
                <span className="chip">{t("settings.chat.keyboardHelp")}</span>
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
              onEditUserMessage={onEditUserMessage}
              searchHitIndices={searchOpen ? searchHitSet : undefined}
              activeSearchIndex={searchOpen || navCursor != null ? activeSearchIndex : null}
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
