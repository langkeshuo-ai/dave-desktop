import { useState, useEffect, useCallback, useRef, Suspense, lazy, useMemo } from "react"
import { ChatView } from "./components/ChatView"
import { Sidebar } from "./components/Sidebar"
import { StatusBar } from "./components/StatusBar"
import { ApprovalDialog } from "./components/ApprovalDialog"
import { LoadingOverlay } from "./components/LoadingSpinner"
import { useStore } from "./stores/useStore"
import type { DaveApi } from "../preload"
import type { ChatStreamChunk, ChatStreamDone, ChatStreamError } from "../shared/types"
import { PanelLeft, Bot, Settings as SettingsIcon, Plus, Sun, Moon, FolderTree } from "lucide-react"
import { formatPathMention } from "../shared/export"
import { estimateMessageTokensRough } from "../shared/context"
import { DEFAULT_CONTEXT_TOKEN_BUDGET } from "../shared/types"
import { track } from "./lib/telemetry"
import { checkStartupBudget, TTFB_BUDGET_MS } from "../shared/telemetry"

// 懒加载非关键组件:首屏不挂载,缩减 renderer 启动 JS 体积,改善冷启动。
// 设计:各自走 React.lazy + Suspense fallback,fallback 用 null 不闪屏,
// 因为这些组件都是"按需打开"型,触发时才挂载、当时 fallback 已被替换。
const Settings = lazy(() => import("./components/Settings").then((m) => ({ default: m.Settings })))
const CommandPalette = lazy(() =>
  import("./components/CommandPalette").then((m) => ({ default: m.CommandPalette })),
)
const KeyboardHelp = lazy(() =>
  import("./components/KeyboardHelp").then((m) => ({ default: m.KeyboardHelp })),
)
const WorkspacePanel = lazy(() =>
  import("./components/WorkspacePanel").then((m) => ({ default: m.WorkspacePanel })),
)
const Welcome = lazy(() => import("./components/Welcome").then((m) => ({ default: m.Welcome })))
const ApiKeyWizard = lazy(() =>
  import("./components/ApiKeyWizard").then((m) => ({ default: m.ApiKeyWizard })),
)

interface ApprovalRequest {
  sessionId: string
  tool: string
  args: Record<string, unknown>
  mutates: boolean
  isShell: boolean
}

declare global {
  interface Window {
    dave: DaveApi
  }
}

type Mode = "ask" | "suggest" | "auto" | "full-auto"
export type { Mode }
type Theme = "light" | "night"

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  // Onboarding 流:
  // - "welcome"  : 首屏三屏介绍
  // - "apikey"   : 选 Provider + 粘 Key + 选工作区
  // - "off"      : 不再展示
  // 设计成显式状态机,避免布尔嵌套 + state 不同步。
  const [onboarding, setOnboarding] = useState<"welcome" | "apikey" | "off">("off")
  const [mode, setMode] = useState<Mode>("ask")
  const [theme, setTheme] = useState<Theme>("light")
  // 新建会话的 in-flight 守卫,防止双击 / 菜单 + 按钮并发触发
  // 产生"孤儿会话"(后者覆盖前者,但前者已落库)。
  const creatingSessionRef = useRef(false)
  const [workspace, setWorkspace] = useState("")
  const [approval, setApproval] = useState<ApprovalRequest | null>(null)
  const [insertSnippet, setInsertSnippet] = useState<string | null>(null)
  // 状态栏:与 StatusBarProps 状态枚举保持一致。
  // status 为字面量联合,避免后续 setStatus("xxx") 时被推断为 string。
  const [status, setStatus] = useState<"idle" | "running" | "warn" | "error">("idle")
  const [statusMsg, setStatusMsg] = useState<string>("")
  // 首条消息标记:用于触发 first_message_sent 漏斗事件(每个 session 一次)。
  const firstMessageSentRef = useRef<Set<string>>(new Set())

  const {
    sessions,
    currentSessionId,
    messages,
    streamingContent,
    isStreaming,
    error,
    loadSessions,
    createSession,
    switchSession,
    deleteSession,
    addMessage,
    appendStreamingContent,
    setStreamingContent,
    setStreaming,
    setError,
    loadSession,
  } = useStore()

  // 首问 TTFB 计时:在 handleSendMessage 启动一次,首个 chunk 到达时打点。
  // 用 useRef 而不是 state,避免每次 setState 触发重渲染(影响 TTFB 测量本身)。
  const ttfbStartedAtRef = useRef<number | null>(null)

  // Apply theme to <html> via class "night" — globals.css reads it to override vars.
  useEffect(() => {
    document.documentElement.classList.toggle("night", theme === "night")
    void window.dave.store.set("theme", theme)
  }, [theme])

  // Renderer ready 性能打点:React 首次 effect 跑完 = 渲染端可交互。
  // 配合主进程 first_window_shown,端到端 cold start = elapsedMs + 网络/IPC。
  useEffect(() => {
    track("renderer_ready")
  }, [])

  // Load persisted theme + workspace + session list on mount.
  // store.get 的 Promise 加 .catch 兜底,避免 unhandled rejection 噪音(IPC 偶发失败不应崩日志)。
  useEffect(() => {
    window.dave.store.get("theme").then(
      (t: string | null) => {
        if (t === "night") setTheme("night")
      },
      () => {
        /* IPC 失败时静默走 light 默认值 */
      },
    )
    window.dave.store.get("cwd").then(
      (w: string | null) => {
        if (w) setWorkspace(w)
      },
      () => {
        /* 同上 */
      },
    )
    window.dave.store.get("mode").then(
      (m: string | null) => {
        if (m === "suggest" || m === "auto" || m === "full-auto") setMode(m)
      },
      () => {
        /* 同上 */
      },
    )
    // Restore last session (or first) so the sidebar is not empty after relaunch.
    void (async () => {
      await loadSessions()
      const list = useStore.getState().sessions
      if (list.length === 0) return
      const last = await window.dave.store.get("last-session-id")
      const pick = last && list.some((s) => s.id === last) ? last : list[0].id
      switchSession(pick)
      await loadSession(pick)
    })()
    // 首启判定:从未完成过 onboarding_completed 即视为首启。
    // 用 IPC 查询而不是 store.has,避免重复读 store。
    void window.dave.telemetry.isFirstRun().then((first) => {
      if (first) {
        track("app_launch", { ret: "0" })
        setOnboarding("welcome")
        track("onboarding_started")
      } else {
        track("app_launch", { ret: "1" })
      }
    })
  }, [loadSessions, switchSession, loadSession])

  // Remember last session + mode for agent loop / relaunch.
  useEffect(() => {
    void window.dave.store.set("mode", mode)
    if (currentSessionId) {
      void window.dave.store.set("last-session-id", currentSessionId)
    }
    // Auto-open explorer when agent modes need a workspace; keep user toggle for ask.
    if (mode !== "ask" && workspace) setWorkspaceOpen(true)
    if (!workspace) setWorkspaceOpen(false)
  }, [mode, workspace, currentSessionId])

  // Reload workspace when Settings closes (user may have changed cwd).
  const handleSettingsClose = useCallback(() => {
    setSettingsOpen(false)
    void window.dave.store.get("cwd").then((w: string | null) => {
      setWorkspace(w || "")
    })
  }, [])

  // 会话切换:必须前置定义,因为 cbsRef 会在 kbd 快捷键 useEffect 中引用。
  const handleSelectSession = useCallback(
    async (id: string) => {
      // Abort any in-flight stream for the current session before switching.
      if (currentSessionId) {
        void window.dave.chat.abort(currentSessionId)
      }
      switchSession(id)
      track("session_switched", { id, via: "select" })
      await loadSession(id)
      setStatusMsg("已切换会话")
      setStatus("idle")
    },
    [currentSessionId, switchSession, loadSession],
  )

  // 新建会话:用 creatingSessionRef 防止菜单(Cmd+N)与侧栏"+"
  // 按钮并发触发导致产生孤儿会话(后者覆盖前者,但前者已落库)。
  // 注意:handleSendMessage 内也有类似 createSession 调用,它的
  // currentSessionId 双检可独立收敛,这里不重复处理。
  const handleNewSession = useCallback(async () => {
    if (creatingSessionRef.current) return
    creatingSessionRef.current = true
    try {
      const id = await createSession()
      if (!id) return
      track("session_created", { via: "manual" })
      await loadSessions()
      switchSession(id)
      track("session_switched", { id, via: "new" })
      await loadSession(id)
      setStatusMsg("新会话已创建")
      setStatus("idle")
    } finally {
      creatingSessionRef.current = false
    }
  }, [createSession, loadSessions, switchSession, loadSession])

  useEffect(() => {
    const unsubMenu = window.dave.menu.onAction((action: string) => {
      if (action === "new-session") void handleNewSession()
      if (action === "open-settings") {
        track("settings_opened", { via: "menu" })
        setSettingsOpen(true)
      }
      if (action === "open-palette") {
        track("palette_opened", { via: "menu" })
        setPaletteOpen((v) => !v)
      }
    })
    return unsubMenu
  }, [handleNewSession])

  // 全局快捷键:
  //  - Cmd/Ctrl+K        → 命令面板 toggle
  //  - Cmd/Ctrl+N        → 新建会话
  //  - Cmd/Ctrl+,        → 设置
  //  - Cmd/Ctrl+1..9     → 跳转最近第 N 个会话
  //  - Esc               → 关弹窗；无弹窗且流式中则停止生成
  //  - Alt+Up/Down       → 上一/下一会话(在侧栏可见时启用)
  // 只在不在输入态(不在 textarea/contenteditable)时拦截,避免与正文编辑冲突。
  // 用 ref 拿到最新的 callbacks,避免 effect 依赖频繁变化导致重绑。
  const cbsRef = useRef<{
    handleSelectSession: (id: string) => void
    handleNewSession: () => void
    handleAbort: () => void
    sidebarOpen: boolean
    paletteOpen: boolean
    helpOpen: boolean
    settingsOpen: boolean
    hasApproval: boolean
    isStreaming: boolean
  }>({
    handleSelectSession: (_: string) => {},
    handleNewSession: () => {},
    handleAbort: () => {},
    sidebarOpen: true,
    paletteOpen: false,
    helpOpen: false,
    settingsOpen: false,
    hasApproval: false,
    isStreaming: false,
  })
  // handleAbort 在下方定义；此处先用 ref 占位，后续 effect 会同步最新实现。
  const handleAbortRef = useRef<() => void>(() => {})
  useEffect(() => {
    cbsRef.current = {
      handleSelectSession: (id: string) => {
        void handleSelectSession(id)
      },
      handleNewSession: () => {
        void handleNewSession()
      },
      handleAbort: () => handleAbortRef.current(),
      sidebarOpen,
      paletteOpen,
      helpOpen,
      settingsOpen,
      hasApproval: approval !== null,
      isStreaming,
    }
  }, [
    handleSelectSession,
    handleNewSession,
    sidebarOpen,
    paletteOpen,
    helpOpen,
    settingsOpen,
    approval,
    isStreaming,
  ])
  useEffect(() => {
    const isEditable = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false
      const tag = el.tagName
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return true
      if (el.isContentEditable) return true
      return false
    }
    const onKey = (e: KeyboardEvent) => {
      // IME 合成期:中文/日文/韩文候选窗期,Enter/Space 等键不应被全局快捷键截胡。
      // keyCode === 229 是 Chromium IME 合成期的兼容值(老测试稳定)。
      // 修复:之前遗漏此处,会与 Welcome / ApiKeyWizard 里的 Enter/←→ 冲突。
      if (e.isComposing || e.keyCode === 229) return
      const mod = e.metaKey || e.ctrlKey
      // Cmd/Ctrl+K 总是拦截(命令面板是顶级 UI)
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault()
        track("palette_opened", { via: "shortcut" })
        setPaletteOpen((v) => !v)
        return
      }
      // Cmd/Ctrl+N 新建会话（输入框内也允许，与常见 IDE 一致）
      if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault()
        cbsRef.current.handleNewSession()
        return
      }
      // Cmd/Ctrl+, 打开设置
      if (mod && e.key === ",") {
        e.preventDefault()
        track("settings_opened", { via: "shortcut" })
        setSettingsOpen(true)
        return
      }
      // Cmd/Ctrl+1..9 跳转会话列表第 N 项
      if (mod && e.key >= "1" && e.key <= "9") {
        e.preventDefault()
        const list = useStore.getState().sessions
        const target = list[Number(e.key) - 1]
        if (target) void cbsRef.current.handleSelectSession(target.id)
        return
      }
      // Esc：弹窗优先关闭；否则流式中停止生成（输入框内也生效，方便打断）
      if (e.key === "Escape") {
        const s = cbsRef.current
        if (s.paletteOpen) {
          e.preventDefault()
          setPaletteOpen(false)
          return
        }
        if (s.helpOpen) {
          e.preventDefault()
          setHelpOpen(false)
          return
        }
        if (s.settingsOpen) {
          e.preventDefault()
          setSettingsOpen(false)
          return
        }
        // 批准对话框由自身 capture 处理，这里不抢
        if (s.hasApproval) return
        if (s.isStreaming) {
          e.preventDefault()
          s.handleAbort()
          return
        }
        return
      }
      if (isEditable(e.target)) return
      // `?` 键 (Shift+/) 打开键盘帮助面板
      if (e.key === "?" && e.shiftKey) {
        e.preventDefault()
        track("help_opened")
        setHelpOpen(true)
        return
      }
      if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        if (!cbsRef.current.sidebarOpen) return
        e.preventDefault()
        const list = useStore.getState().sessions
        if (list.length === 0) return
        const cur = useStore.getState().currentSessionId
        const idx = Math.max(
          0,
          list.findIndex((s) => s.id === cur),
        )
        const next =
          e.key === "ArrowDown"
            ? list[Math.min(list.length - 1, idx + 1)]
            : list[Math.max(0, idx - 1)]
        if (next && next.id !== cur) {
          void cbsRef.current.handleSelectSession(next.id)
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    // Chunks are deltas — always append. Main never sends full-text replace by default.
    const unsubChunk = window.dave.chat.onChunk((data: ChatStreamChunk) => {
      if (data.sessionId !== currentSessionId) return
      // 首个 chunk 到达:打 TTFB 点(若在测量窗口内)。
      // 注意:只打一次,后续 chunk 不再触发(避免污染预算判断)。
      if (ttfbStartedAtRef.current != null) {
        const now = typeof performance !== "undefined" ? performance.now() : Date.now()
        const ttfbMs = Math.round(now - (ttfbStartedAtRef.current ?? now))
        ttfbStartedAtRef.current = null
        const verdict = checkStartupBudget("ttfb", ttfbMs)
        track("ttfb_recorded", {
          ms: String(ttfbMs),
          within: verdict.within ? "1" : "0",
          budgetMs: String(TTFB_BUDGET_MS),
        })
      }
      if (data.replace) setStreamingContent(data.content)
      else appendStreamingContent(data.content)
      setStatus("running")
      setStatusMsg("生成中…")
    })
    const unsubDone = window.dave.chat.onDone((data: ChatStreamDone) => {
      if (data.sessionId !== currentSessionId) return
      // 主进程会在发送 aborted done 前先持久化 partial；渲染端只清空临时态，
      // 随后的 loadSession 读取单一事实源，避免本地 addMessage 被旧快照覆盖。
      setStreamingContent("")
      setStreaming(false)
      if (data.sessionId) {
        // Reload messages + session list so autoTitle (first user line) appears in sidebar.
        void loadSession(data.sessionId)
        void loadSessions()
      }
      setStatus("idle")
      setStatusMsg(data.aborted ? "已停止" : "就绪")
    })
    const unsubError = window.dave.chat.onError((data: ChatStreamError) => {
      if (data.sessionId !== currentSessionId) return
      setStreaming(false)
      setStreamingContent("")
      setError(data.error)
      setStatus("error")
      setStatusMsg(data.error)
    })
    const unsubApproval = window.dave.chat.onApproval(
      (req: {
        sessionId: string
        tool: string
        arguments: Record<string, unknown>
        mutates: boolean
        isShell: boolean
      }) => {
        if (req.sessionId !== currentSessionId) return
        setApproval({
          sessionId: req.sessionId,
          tool: req.tool,
          args: req.arguments,
          mutates: req.mutates,
          isShell: req.isShell,
        })
        setStatus("warn")
        setStatusMsg(`待批准：${req.tool}`)
      },
    )
    // Patch events become a discrete assistant message (not mixed into streamingContent).
    const unsubPatch = window.dave.chat.onPatch(
      (data: { sessionId: string; patch: string; paths?: string[] }) => {
        if (data.sessionId !== currentSessionId) return
        addMessage({ role: "assistant", content: `@@ patch\n${data.patch}` })
        setStatusMsg("提议补丁中…")
      },
    )
    const unsubTools = window.dave.chat.onTools?.(
      (data: { sessionId: string; tools: string[] }) => {
        if (data.sessionId !== currentSessionId) return
        setStatus("running")
        setStatusMsg(`工具：${data.tools.join(" · ")}`)
      },
    )
    return () => {
      unsubChunk()
      unsubDone()
      unsubError()
      unsubApproval()
      unsubPatch()
      unsubTools?.()
    }
  }, [
    currentSessionId,
    appendStreamingContent,
    setStreamingContent,
    setStreaming,
    setError,
    loadSession,
    loadSessions,
    addMessage,
  ])

  const handleApprove = useCallback((sid: string, approved: boolean) => {
    void window.dave.chat.approve(sid, approved)
    setApproval(null)
    setStatus("running")
    setStatusMsg(approved ? "已批准 — 继续执行" : "已拒 — 续下轮")
  }, [])

  const handleAbort = useCallback(() => {
    if (currentSessionId) {
      void window.dave.chat.abort(currentSessionId)
    }
  }, [currentSessionId])
  handleAbortRef.current = handleAbort

  const handleSendMessage = useCallback(
    async (content: string) => {
      // Gate: API key + workspace for agent modes (Cursor-style empty-state guidance).
      try {
        const provider = (await window.dave.store.get("provider")) || "openai"
        const primary =
          provider === "custom"
            ? await window.dave.store.get("custom-api-key")
            : await window.dave.store.get(`${provider}-api-key`)
        const fallback = await window.dave.store.get(`${provider}-api-key`)
        if (!(primary || fallback)?.trim()) {
          setError("请先在设置中配置 API Key")
          setStatus("warn")
          setStatusMsg("未配置 API Key")
          setSettingsOpen(true)
          return
        }
        if (mode !== "ask") {
          const cwd = (await window.dave.store.get("cwd")) || workspace
          if (!cwd?.trim()) {
            setError("Agent 模式需要工作区 — 请在设置中选择目录")
            setStatus("warn")
            setStatusMsg("未配置工作区")
            setSettingsOpen(true)
            return
          }
        }
      } catch {
        /* proceed; main will error if needed */
      }

      let sid = currentSessionId
      if (!sid) {
        const newId = await createSession()
        if (!newId) return
        await loadSessions()
        switchSession(newId)
        await loadSession(newId)
        sid = newId
      }

      // Double-check: session may have changed during the async create flow.
      const current = useStore.getState().currentSessionId
      if (current !== sid) return

      addMessage({ role: "user", content })
      setStreamingContent("")
      setStreaming(true)
      setError(null)
      setStatus("running")
      setStatusMsg(
        mode === "full-auto" ? "全自动执行中" : mode === "auto" ? "自动执行中" : "思考中",
      )

      // 漏斗:每个 session 首条消息打点一次,辅助计算首问转化率。
      if (!firstMessageSentRef.current.has(sid)) {
        firstMessageSentRef.current.add(sid)
        track("first_message_sent", { mode, hasWorkspace: workspace ? "1" : "0" })
      }
      track("message_sent", { mode, len: String(content.length) })

      // TTFB 起点:从这一刻起,到第一个 chunk 到达 = 端到端首问延迟。
      // 用 performance.now() 而非 Date.now(),精度到亚毫秒,且不受系统时钟跳变影响。
      ttfbStartedAtRef.current = typeof performance !== "undefined" ? performance.now() : Date.now()

      void window.dave.chat.stream(content, sid).catch((err: unknown) => {
        if (useStore.getState().currentSessionId !== sid) return
        setStreaming(false)
        setStreamingContent("")
        const message = err instanceof Error ? err.message : String(err)
        setError(message || "消息发送失败")
        setStatus("error")
        setStatusMsg("消息发送失败")
        void loadSession(sid)
      })
    },
    [
      currentSessionId,
      createSession,
      loadSessions,
      switchSession,
      loadSession,
      addMessage,
      setStreaming,
      setStreamingContent,
      setError,
      mode,
      workspace,
    ],
  )

  // 重新生成：截断末条 user 之后的回复，再以同一 user 内容发流，避免历史重复堆叠。
  const handleRegenerate = useCallback(
    (_userContent: string) => {
      if (isStreaming) return
      void (async () => {
        const { planRegenerate } = await import("../shared/session-edit")
        const sid = useStore.getState().currentSessionId
        if (!sid) return
        const plan = planRegenerate(useStore.getState().messages)
        if (!plan || !plan.userContent.trim()) return
        void window.dave.chat.abort(sid)
        const ok = await window.dave.session.replaceMessages(sid, plan.prefix)
        if (!ok) return
        useStore.getState().setMessages(plan.prefix)
        setStreamingContent("")
        setError(null)
        void handleSendMessage(plan.userContent)
      })()
    },
    [isStreaming, handleSendMessage, setStreamingContent, setError],
  )

  // 编辑历史 user 消息：截断该条及之后，再以新内容重新生成。
  const handleEditUserMessage = useCallback(
    (index: number, newContent: string) => {
      if (isStreaming) return
      const trimmed = newContent.trim()
      if (!trimmed) return
      void (async () => {
        const { messagesBeforeUserEdit } = await import("../shared/session-edit")
        const sid = useStore.getState().currentSessionId
        if (!sid) return
        const prefix = messagesBeforeUserEdit(useStore.getState().messages, index)
        if (!prefix) return
        void window.dave.chat.abort(sid)
        const ok = await window.dave.session.replaceMessages(sid, prefix)
        if (!ok) return
        useStore.getState().setMessages(prefix)
        setStreamingContent("")
        setError(null)
        track("message_edited", { idx: String(index), len: String(trimmed.length) })
        void handleSendMessage(trimmed)
      })()
    },
    [isStreaming, handleSendMessage, setStreamingContent, setError],
  )

  const handleDeleteSession = useCallback(
    async (id: string) => {
      // 闭包守卫:deleteSession 是 async,等待期间用户可能已切换到别的会话。
      // 此时捕获的 currentSessionId 已过期,需以 store 最新值判断,
      // 否则会"误判自己还在被删会话上",触发错误的 switch。
      const deletingCurrent = useStore.getState().currentSessionId === id
      await deleteSession(id)
      track("session_deleted", { wasCurrent: deletingCurrent ? "1" : "0" })
      await loadSessions()
      if (deletingCurrent) {
        const stored = useStore.getState()
        if (stored.sessions.length > 0) {
          const nextId = stored.sessions[0].id
          switchSession(nextId)
          track("session_switched", { id: nextId, via: "post-delete" })
          await loadSession(nextId)
        } else {
          const newId = await createSession()
          if (newId) {
            track("session_created", { via: "post-delete" })
            await loadSessions()
            switchSession(newId)
            track("session_switched", { id: newId, via: "post-delete" })
            await loadSession(newId)
          }
        }
      }
      setStatusMsg("会话已删除")
    },
    [deleteSession, loadSessions, switchSession, loadSession, createSession],
  )

  const modeLabel: Record<Mode, string> = {
    ask: "询问",
    suggest: "建议",
    auto: "自动",
    "full-auto": "全自动",
  }

  // tokenCount 用 useMemo 缓存:messages 引用稳定时跳过 reduce 重算,
  // 避免 App 每次重渲染(状态栏 / 主题 / 模式切换等)都全量重算所有消息 token。
  const tokenCount = useMemo(() => {
    let n = messages.reduce((s, m) => s + estimateMessageTokensRough(m), 0)
    if (streamingContent) {
      n += estimateMessageTokensRough({ role: "assistant", content: streamingContent })
    }
    return n
  }, [messages, streamingContent])

  const currentTitle = sessions.find((s) => s.id === currentSessionId)?.title || "会话"

  return (
    <div className="h-screen flex flex-col bg-[var(--bg)] text-[var(--text)]">
      {/* Title Bar — Cursor custom (dark even in light mode) */}
      <header className="titlebar shrink-0">
        {/* Left cluster: sidebar toggle + logo */}
        <div className="flex items-center gap-2 px-2 no-drag">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="btn-icon"
            title={sidebarOpen ? "收起侧栏" : "展开侧栏"}
            aria-label="切换侧栏"
          >
            <PanelLeft size={16} />
          </button>
          <div className="flex items-center gap-1.5 px-1.5">
            <div className="w-4 h-4 rounded bg-[var(--accent)] flex items-center justify-center">
              <Bot size={11} className="text-white" />
            </div>
            <span className="text-xs text-white font-medium">Dave</span>
            <span className="text-[10px] text-[var(--text-on-inverse-dim)] ml-1">Desktop</span>
          </div>
        </div>

        {/* Center: drag region (window movable) */}
        <div className="drag-region flex items-center justify-center">
          <span className="text-[11px] text-[var(--text-on-inverse-dim)]">
            {currentSessionId ? "会话" : "—"}
          </span>
        </div>

        {/* Right cluster: new session + workspace + theme + settings */}
        <div className="flex items-center gap-1 px-2 no-drag">
          <button
            onClick={() => void handleNewSession()}
            className="btn-icon"
            title="新建会话"
            aria-label="新建会话"
          >
            <Plus size={16} />
          </button>
          <button
            onClick={() => setWorkspaceOpen(!workspaceOpen)}
            className={`btn-icon ${workspaceOpen ? "active" : ""}`}
            title={workspace ? "工作区面板" : "请先在设置中配置工作区"}
            aria-label="切换工作区面板"
            disabled={!workspace}
          >
            <FolderTree size={16} />
          </button>
          <button
            onClick={() => void setTheme(theme === "light" ? "night" : "light")}
            className="btn-icon"
            title={theme === "light" ? "切换到夜晚模式" : "切换到浅白模式"}
            aria-label="切换主题"
          >
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="btn-icon"
            title="设置"
            aria-label="设置"
          >
            <SettingsIcon size={16} />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        {sidebarOpen && (
          <Sidebar
            sessions={sessions}
            currentSessionId={currentSessionId}
            onSelectSession={(id) => void handleSelectSession(id)}
            onNewSession={() => void handleNewSession()}
            onDeleteSession={(id) => void handleDeleteSession(id)}
            onRenameSession={async (id, title) => {
              await window.dave.session.updateTitle(id, title)
              await loadSessions()
            }}
          />
        )}

        {/* Explorer: available whenever a workspace is set (ask mode may still @-mention). */}
        {workspaceOpen && workspace && (
          <div className="w-60 panel border-r-0 border-l border-[var(--border)] shrink-0">
            <Suspense fallback={null}>
              <WorkspacePanel
                workspace={workspace}
                onPickPath={(rel) => {
                  setInsertSnippet(formatPathMention(rel))
                  setStatusMsg(`已引用 ${rel}`)
                  setStatus("idle")
                }}
              />
            </Suspense>
          </div>
        )}

        {/* Chat Area */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[var(--bg)]">
          {currentSessionId ? (
            <ChatView
              mode={mode}
              onModeChange={setMode}
              messages={messages}
              streamingContent={streamingContent}
              isStreaming={isStreaming}
              error={error}
              onSendMessage={(msg) => void handleSendMessage(msg)}
              onAbort={handleAbort}
              onRegenerate={(msg) => void handleRegenerate(msg)}
              onEditUserMessage={(idx, content) => handleEditUserMessage(idx, content)}
              workspace={workspace}
              sessionId={currentSessionId}
              sessionTitle={currentTitle}
              insertSnippet={insertSnippet}
              onInsertConsumed={() => setInsertSnippet(null)}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center bg-[var(--bg)]">
              <div className="empty-state">
                <div className="empty-state-icon">
                  <Bot size={22} />
                </div>
                <h2 className="empty-state-title">Dave Desktop</h2>
                <p className="empty-state-desc">
                  本地 Agent · 浅白 Cursor UI · 四种批准模式 · 工作区读写 · unified-diff
                </p>
                <div className="empty-state-meta">
                  <span className="chip">ask / suggest / auto / full-auto</span>
                  <span className="chip">patch · shell · AST</span>
                  <span className="chip chip-accent">Codex 工具集</span>
                </div>
                <button onClick={() => void handleNewSession()} className="btn">
                  新建会话
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Status Bar */}
      <StatusBar
        status={status}
        message={statusMsg}
        mode={modeLabel[mode]}
        sessionCount={sessions.length}
        workspace={workspace}
        tokenCount={tokenCount}
        tokenBudget={DEFAULT_CONTEXT_TOKEN_BUDGET}
      />

      {/* Settings Modal — reload workspace on close */}
      <Suspense fallback={<LoadingOverlay />}>
        {settingsOpen && (
          <Settings
            onClose={handleSettingsClose}
            onReopenWelcome={() => {
              track("onboarding_reopened", { via: "settings" })
              setSettingsOpen(false)
              setOnboarding("welcome")
            }}
          />
        )}
      </Suspense>

      {/* Command palette — Cmd+K */}
      <Suspense fallback={<LoadingOverlay />}>
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelectSession={(id) => void handleSelectSession(id)}
          onNewSession={() => void handleNewSession()}
          onOpenSettings={() => setSettingsOpen(true)}
          onToggleTheme={() => setTheme(theme === "light" ? "night" : "light")}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          theme={theme}
          sidebarOpen={sidebarOpen}
        />
      </Suspense>

      {/* Keyboard help — `?` 键 */}
      <Suspense fallback={<LoadingOverlay />}>
        <KeyboardHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      </Suspense>

      {/* Agent approval dialog — surfaces when a tool needs user OK per mode rules */}
      {approval && (
        <ApprovalDialog
          sessionId={approval.sessionId}
          tool={approval.tool}
          args={approval.args}
          mutates={approval.mutates}
          isShell={approval.isShell}
          onApprove={handleApprove}
        />
      )}

      {/* Onboarding 流 —— 首启展示,完成 / 跳过即关。 */}
      <Suspense fallback={<LoadingOverlay />}>
        {onboarding === "welcome" && (
          <Welcome
            onComplete={() => setOnboarding("apikey")}
            onSkip={() => {
              track("onboarding_skipped", { at: "welcome" })
              setOnboarding("off")
            }}
          />
        )}
        {onboarding === "apikey" && (
          <ApiKeyWizard
            onClose={() => setOnboarding("off")}
            onCompleted={() => setOnboarding("off")}
          />
        )}
      </Suspense>
    </div>
  )
}
