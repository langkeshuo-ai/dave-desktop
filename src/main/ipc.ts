import { ipcMain, app, BrowserWindow, dialog, shell, Notification } from "electron"
import { stat } from "node:fs/promises"
import { basename } from "node:path"
import { getStore } from "./store"
import log from "electron-log"
import { autoLaunch } from "./autolaunch"
import { applyWorkspaceDiff, toolFileTree } from "./agent"
import { probeProviderConnection } from "./providers"
import { abortSession, handleChatStream, resolveApproval } from "./chat-loop"
import {
  createSession,
  deleteSession,
  getSession,
  getSessionList,
  replaceSessionMessages,
  updateSessionTitle,
} from "./session"
import {
  clearEvents,
  getFunnelSnapshot,
  isFirstRun,
  readEvents,
  trackEvent,
} from "./telemetry-store"
import { TELEMETRY_EVENT_NAMES, type TelemetryEventName } from "../shared/telemetry"
import { isAllowedStoreKey, sanitizeSessionTitle, STORE_VALUE_MAX } from "../shared/store-policy"
import { appendEvent, readStructuredEvents } from "./structured-log"
import { exportDiagnostics } from "./diagnostics"
import { mcpManager } from "./mcp-client"
import { parseMcpServers } from "../shared/mcp"
import { isValidLogLevel } from "../shared/log-level"
import { parseSkills } from "../shared/skills"
import { createRateLimiter, SENSITIVE_IPC_LIMIT } from "../shared/rate-limit"
import { sanitizeMessagesForReplace } from "../shared/session-edit"
import { getSecure, setSecure } from "./store"

// 敏感 IPC 滑动窗口限流：防渲染端被注入后高频刷 store / 开流 / 写盘。
const storeSetLimiter = createRateLimiter(SENSITIVE_IPC_LIMIT)
const chatStreamLimiter = createRateLimiter(SENSITIVE_IPC_LIMIT)
const applyPatchLimiter = createRateLimiter({ max: 10, windowMs: 1000 })

// 白名单 Set:O(1) 查找,防止渲染端注入未知事件名。
const TELEMETRY_NAME_SET: Set<string> = new Set(TELEMETRY_EVENT_NAMES)
function isKnownTelemetryEvent(name: string): name is TelemetryEventName {
  return TELEMETRY_NAME_SET.has(name)
}

// store key 白名单 + session title 校验逻辑抽到 shared/store-policy.ts,
// 与 shell-policy.ts 对称:让 main 层只做 IPC adapter,node 环境可直接单测。
// API Key 字段(以 -api-key 结尾)走 safeStorage 加解密,见 store.ts getSecure/setSecure。

type Deps = {
  getMainWindow: () => BrowserWindow | null
  showWindow: () => void
}

type SenderEvent = {
  sender: { id?: number; getURL?: () => string }
  senderFrame?: { url?: string; top?: unknown } | null
}

// Idempotency guard — electron-vite CJS-shim can re-run this module.
let registered = false
let trustedMainWindow: (() => BrowserWindow | null) | null = null

function isTrustedRendererUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (app.isPackaged) return parsed.protocol === "file:"
    return (
      parsed.protocol === "file:" ||
      (parsed.protocol === "http:" && parsed.hostname === "localhost" && parsed.port === "5173")
    )
  } catch {
    return false
  }
}

/** 仅允许唯一主窗口的顶层可信 frame 调用高权限 IPC。 */
export function validateSender(
  event: SenderEvent,
  trustedWindowOverride?: Pick<BrowserWindow, "webContents">,
): boolean {
  const main = trustedWindowOverride ?? trustedMainWindow?.()
  if (!main || event.sender.id !== main.webContents.id) {
    log.warn("IPC sender validation failed: sender is not the trusted main window")
    return false
  }

  const frame = event.senderFrame
  if (!frame || (frame.top !== undefined && frame.top !== frame)) {
    log.warn("IPC sender validation failed: sender is not the top frame")
    return false
  }
  const frameUrl = frame.url || event.sender.getURL?.() || ""
  if (!isTrustedRendererUrl(frameUrl)) {
    log.warn("IPC sender validation failed: untrusted renderer URL")
    return false
  }
  return true
}

export function registerIpcHandlers(deps: Deps) {
  if (registered) {
    log.warn("registerIpcHandlers called twice — skipping duplicate IPC registration")
    return
  }
  registered = true
  trustedMainWindow = deps.getMainWindow

  ipcMain.handle("store-get", async (event, key: string) => {
    if (!validateSender(event)) return null
    // 白名单校验:防止渲染端被注入后读取任意 key(虽然 store 内容不敏感,
    // 但 API Key 等字段仍不应被任意 key 探测枚举)。
    if (!isAllowedStoreKey(key)) return null
    // API Key 字段走 safeStorage 解密读取
    const v = await getSecure(key)
    return v
  })

  ipcMain.handle("store-set", async (event, key: string, value: string) => {
    if (!validateSender(event)) return
    if (!storeSetLimiter.allow()) {
      log.warn("IPC rate limited: store-set")
      appendEvent("warn", "ipc_rate_limited", { channel: "store-set" })
      return
    }
    // 白名单 + 长度校验:value 上限 STORE_VALUE_MAX,防止渲染端写超长字符串撑爆 store 文件。
    if (!isAllowedStoreKey(key)) return
    if (typeof value !== "string" || value.length > STORE_VALUE_MAX) return
    // API Key 字段走 safeStorage 加密后存储
    await setSecure(key, value)
  })

  ipcMain.handle("store-delete", (event, key: string) => {
    if (!validateSender(event)) return
    if (!isAllowedStoreKey(key)) return
    getStore().delete(key)
  })

  ipcMain.handle("store-keys", (event) => {
    if (!validateSender(event)) return []
    const s = getStore() as { store: Record<string, unknown> }
    // 只返回白名单内的 key,避免泄露 API key 名称等敏感字段名。
    return Object.keys(s.store).filter((k) => isAllowedStoreKey(k))
  })

  ipcMain.handle("show-window", (event) => {
    if (!validateSender(event)) return
    deps.showWindow()
  })

  ipcMain.handle(
    "open-directory-picker",
    async (event, opts?: { title?: string; defaultPath?: string }) => {
      if (!validateSender(event)) return null
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", "createDirectory"],
        title: opts?.title ?? "选择文件夹",
        defaultPath: opts?.defaultPath,
      })
      if (result.canceled) return null
      return result.filePaths[0] ?? null
    },
  )

  ipcMain.handle(
    "open-file-picker",
    async (event, opts?: { title?: string; extensions?: string[] }) => {
      if (!validateSender(event)) return null
      const result = await dialog.showOpenDialog({
        properties: ["openFile"],
        title: opts?.title ?? "选择文件",
        filters: opts?.extensions ? [{ name: "Files", extensions: opts.extensions }] : undefined,
      })
      if (result.canceled) return null
      const filePath = result.filePaths[0]
      if (!filePath) return null
      const s = await stat(filePath)
      return { path: filePath, name: basename(filePath), size: s.size }
    },
  )

  ipcMain.handle("open-link", (event, url: string) => {
    if (!validateSender(event)) return
    if (typeof url !== "string" || url.length > 2048) throw new Error("Invalid URL")
    try {
      const u = new URL(url)
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        throw new Error(`Refused to open non-http(s) URL: ${url}`)
      }
    } catch {
      throw new Error(`Invalid URL: ${url}`)
    }
    void shell.openExternal(url)
  })

  ipcMain.handle("show-notification", (event, title: string, body?: string) => {
    if (!validateSender(event)) return false
    if (typeof title !== "string" || title.length === 0 || title.length > 128) return false
    if (body !== undefined && (typeof body !== "string" || body.length > 1024)) return false
    if (!Notification.isSupported()) return false
    new Notification({ title, body }).show()
    return true
  })

  ipcMain.handle("get-platform", (event) => (validateSender(event) ? process.platform : null))
  ipcMain.handle("get-version", (event) => (validateSender(event) ? app.getVersion() : null))

  ipcMain.handle("open-settings", (event) => {
    if (!validateSender(event)) return
    const win = deps.getMainWindow()
    if (win) win.webContents.send("menu-action", "open-settings")
  })

  ipcMain.handle("auto-launch-get", (event) =>
    validateSender(event) ? autoLaunch.isEnabled() : false,
  )
  ipcMain.handle("auto-launch-set", (event, enabled: boolean) => {
    if (!validateSender(event) || typeof enabled !== "boolean") return false
    return autoLaunch.setEnabled(enabled)
  })

  ipcMain.handle("chat-approve", (event, sessionId: string, approved: boolean) => {
    if (!validateSender(event)) return
    resolveApproval(sessionId, approved)
  })

  ipcMain.handle("chat-stream", async (event, message: string, sessionId: string) => {
    if (!validateSender(event)) return
    if (!chatStreamLimiter.allow()) {
      log.warn("IPC rate limited: chat-stream")
      appendEvent("warn", "ipc_rate_limited", { channel: "chat-stream" })
      return
    }
    await handleChatStream(event, message, sessionId)
  })

  ipcMain.handle("chat-abort", (event, sessionId: string) => {
    if (!validateSender(event)) return
    abortSession(sessionId)
  })

  ipcMain.handle("workspace-file-tree", async (event, opts?: { depth?: number }) => {
    if (!validateSender(event)) return []
    const workspace = (getStore().get("cwd") as string) || ""
    if (!workspace) return []
    try {
      const result = await toolFileTree(workspace, { depth: opts?.depth ?? 4 })
      return JSON.parse(result.output)
    } catch {
      return []
    }
  })

  ipcMain.handle("session-list", (event) => (validateSender(event) ? getSessionList() : []))
  ipcMain.handle("session-get", (event, sessionId: string) => {
    if (!validateSender(event)) return null
    return getSession(sessionId)
  })
  ipcMain.handle("session-create", (event) => (validateSender(event) ? createSession() : null))
  ipcMain.handle("session-delete", (event, sessionId: string) => {
    if (!validateSender(event)) return
    deleteSession(sessionId)
  })
  ipcMain.handle("session-update-title", (event, sessionId: string, title: string) => {
    if (!validateSender(event)) return
    // 长度校验委托 shared/store-policy.ts:sanitizeSessionTitle,
    // 非字符串 / 空 / 超长一律返回 null(忽略),正常 trim 后截断到 SESSION_TITLE_MAX。
    const safe = sanitizeSessionTitle(title)
    if (safe === null) return
    updateSessionTitle(sessionId, safe)
  })

  // 编辑/再生成：渲染端截断后整表写回。限流 + 结构校验防注入撑爆 store。
  ipcMain.handle("session-replace-messages", (event, sessionId: string, messages: unknown) => {
    if (!validateSender(event)) return false
    if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 128) {
      return false
    }
    if (!storeSetLimiter.allow()) {
      log.warn("IPC rate limited: session-replace-messages")
      appendEvent("warn", "ipc_rate_limited", { channel: "session-replace-messages" })
      return false
    }
    const safe = sanitizeMessagesForReplace(messages)
    if (safe === null) return false
    // 截断前先 abort，避免旧流把 partial 写回覆盖
    abortSession(sessionId)
    return replaceSessionMessages(sessionId, safe)
  })

  ipcMain.handle(
    "provider-probe",
    async (
      event,
      opts: {
        provider: string
        apiKey: string
        model?: string
        customHost?: string
        customModel?: string
      },
    ) => {
      if (!validateSender(event)) return null
      return probeProviderConnection(opts)
    },
  )

  ipcMain.handle("workspace-apply-patch", async (event, diff: string) => {
    if (!validateSender(event)) return null
    if (!applyPatchLimiter.allow()) {
      log.warn("IPC rate limited: workspace-apply-patch")
      appendEvent("warn", "ipc_rate_limited", { channel: "workspace-apply-patch" })
      return { ok: false, output: "操作过于频繁，请稍后再试", paths: [] }
    }
    const workspace = (getStore().get("cwd") as string) || ""
    if (!workspace) throw new Error("工作区未配置")
    if (!diff?.trim()) throw new Error("空 diff")
    const result = await applyWorkspaceDiff(workspace, diff)
    return { ok: result.ok, output: result.output, paths: result.paths ?? [] }
  })

  ipcMain.handle("open-log-dir", async (event) => {
    if (!validateSender(event)) return null
    const dir = app.getPath("userData")
    await shell.openPath(dir)
    return dir
  })

  // 结构化事件日志读取(Settings 日志查看器)
  ipcMain.handle("logs-read-structured", (event, opts?: { limit?: number }) => {
    if (!validateSender(event)) return []
    const limit = typeof opts?.limit === "number" ? Math.min(Math.max(opts.limit, 1), 500) : 200
    return readStructuredEvents(limit)
  })

  // 日志输出级别控制(roadmap §3.1):debug/info/warn/error,同步文件与控制台并持久化
  ipcMain.handle("logs-set-level", (event, level: unknown) => {
    if (!validateSender(event)) return false
    if (!isValidLogLevel(level)) return false
    log.transports.file.level = level
    log.transports.console.level = level
    getStore().set("log-level", level) // 持久化,重启后保持
    appendEvent("info", "log_level_changed", { level })
    return true
  })

  // 诊断导出:打包日志 + 系统信息 + 会话元数据为单个文本文件
  ipcMain.handle("diagnostics-export", (event) => {
    if (!validateSender(event)) return null
    return exportDiagnostics()
  })

  // ---- MCP 工具集成(复用官方 SDK) -----------------------------------
  ipcMain.handle("mcp-list-tools", (event) => {
    if (!validateSender(event)) return []
    return mcpManager.listTools()
  })
  // 保存 MCP 服务器配置(校验 + 去重)并全量重连;单个失败不阻断
  ipcMain.handle("mcp-servers-set", async (event, raw: unknown) => {
    if (!validateSender(event)) return false
    const configs = parseMcpServers(raw)
    getStore().set("mcp-servers", JSON.stringify(configs))
    await mcpManager.connectAll(configs)
    return true
  })

  // ---- Skills(用户自定义预置技能,0.3.0 M1 第一步) ----------------
  ipcMain.handle("skills-list", (event) => {
    if (!validateSender(event)) return []
    const raw = getStore().get("skills") as string | undefined
    return raw ? parseSkills(JSON.parse(raw) as unknown) : []
  })
  ipcMain.handle("skills-set", (event, raw: unknown) => {
    if (!validateSender(event)) return false
    getStore().set("skills", JSON.stringify(parseSkills(raw)))
    return true
  })

  // ---- 本地遥测(无第三方,只存 electron-store) ------------------------
  // 设计:fire-and-forget,失败静默;不在主路径上阻塞业务。
  ipcMain.handle("telemetry-emit", (event, name: string, props?: Record<string, string>) => {
    if (!validateSender(event)) return
    // 入参校验:name 必须是已知事件名(白名单),防止渲染端被注入撑爆 store。
    if (typeof name !== "string" || name.length === 0 || name.length > 64) return
    if (!isKnownTelemetryEvent(name)) return
    // 白名单字符过滤,防止 props 里塞超长或控制字符撑爆 store。
    if (props) {
      for (const k of Object.keys(props)) {
        if (k.length > 64) return
        const v = props[k]
        if (typeof v !== "string" || v.length > 256) return
      }
    }
    trackEvent(name, props)
  })
  ipcMain.handle("telemetry-funnel", (event) =>
    validateSender(event) ? getFunnelSnapshot() : null,
  )
  ipcMain.handle("telemetry-events", (event) => (validateSender(event) ? readEvents() : []))
  ipcMain.handle("telemetry-clear", (event) => {
    if (!validateSender(event)) return
    clearEvents()
  })
  ipcMain.handle("telemetry-is-first-run", (event) =>
    validateSender(event) ? isFirstRun() : false,
  )
}
