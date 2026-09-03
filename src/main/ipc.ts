import { ipcMain, app, BrowserWindow, dialog, shell, Notification } from "electron"
import { stat } from "node:fs/promises"
import { basename, join } from "node:path"
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
import { parseSkills, SKILL_MAX_COUNT } from "../shared/skills"
import { createRateLimiter, SENSITIVE_IPC_LIMIT } from "../shared/rate-limit"
import { sanitizeMessagesForReplace } from "../shared/session-edit"
import { getSecure, setSecure } from "./store"

// ─── 整合模块（zcode-client → dave-desktop）──────────────────────
import { createIpcSecurity, clearSessionGuardState, channelSchemas } from "./security/ipc-guard"
import {
  createCheckpoint,
  listCheckpoints,
  getCheckpoint,
  previewRewind,
} from "./session/checkpoints"
import { listSkills, readSkill, skillsSystemPrompt } from "./skills/skills-manager"
import { PluginManager } from "./plugins/plugin-manager"
import {
  getTodayUsage,
  getUsageSummary,
  getDailyUsage,
  exportUsage,
  purgeUsageBefore,
} from "./telemetry/usage-tracker"
import {
  listMarketplaces,
  listInstalledPlugins,
  installPlugin,
  uninstallPlugin,
  describePlugin,
  upgradePlugin,
  updateMarketplace,
} from "./marketplace/marketplace-client"
import {
  getUpdateStatus,
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
  setUpdateConfig,
  wireAutoUpdater,
} from "./updater/updater-service"
import { CollaborationSession, getCollaboration } from "./multi-agent/orchestrator"
import {
  planGoal,
  executeTask,
  reviewResult,
  synthesize,
  negotiate,
  ceoDecide,
} from "./multi-agent/llm-bridge"
import {
  listCollaborations,
  loadCollaboration,
  deleteCollaboration,
} from "./multi-agent/persistence"

// PluginManager 单例 — 插件目录由 paths.ts 的 davePluginsRoot() 决定
const pluginManager = new PluginManager()

// 敏感 IPC 滑动窗口限流：防渲染端被注入后高频刷 store / 开流 / 写盘。
const storeSetLimiter = createRateLimiter(SENSITIVE_IPC_LIMIT)
const chatStreamLimiter = createRateLimiter(SENSITIVE_IPC_LIMIT)
const applyPatchLimiter = createRateLimiter({ max: 10, windowMs: 1000 })
const sessionOpsLimiter = createRateLimiter({ max: 20, windowMs: 1000 })

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
    if (!sessionOpsLimiter.allow()) {
      log.warn("IPC rate limited: chat-approve")
      appendEvent("warn", "ipc_rate_limited", { channel: "chat-approve" })
      return
    }
    resolveApproval(sessionId, approved)
  })

  ipcMain.handle("chat-stream", async (event, message: string, sessionId: string) => {
    if (!validateSender(event)) return
    if (typeof message !== "string" || message.length > 100_000) {
      log.warn("chat-stream rejected: message too long or invalid type")
      return
    }
    if (!chatStreamLimiter.allow()) {
      log.warn("IPC rate limited: chat-stream")
      appendEvent("warn", "ipc_rate_limited", { channel: "chat-stream" })
      return
    }
    // Feature flag removed: @dave/agent SDK path was experimental, not shipped.
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
  ipcMain.handle("session-create", (event) => {
    if (!validateSender(event)) return null
    if (!sessionOpsLimiter.allow()) {
      log.warn("IPC rate limited: session-create")
      appendEvent("warn", "ipc_rate_limited", { channel: "session-create" })
      return null
    }
    return createSession()
  })
  ipcMain.handle("session-delete", (event, sessionId: string) => {
    if (!validateSender(event)) return
    if (!sessionOpsLimiter.allow()) {
      log.warn("IPC rate limited: session-delete")
      appendEvent("warn", "ipc_rate_limited", { channel: "session-delete" })
      return
    }
    deleteSession(sessionId)
    // 联动清理该会话的推送时序守卫状态，防止残留机器陈旧误判
    clearSessionGuardState(sessionId)
  })
  ipcMain.handle("session-update-title", (event, sessionId: string, title: string) => {
    if (!validateSender(event)) return
    if (!sessionOpsLimiter.allow()) {
      log.warn("IPC rate limited: session-update-title")
      appendEvent("warn", "ipc_rate_limited", { channel: "session-update-title" })
      return
    }
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
    try {
      const raw = getStore().get("skills") as string | undefined
      return raw ? parseSkills(JSON.parse(raw) as unknown) : []
    } catch {
      // store 值损坏(非法 JSON):静默返回空,与 chat-loop readSkillsFromStore 一致
      return []
    }
  })
  ipcMain.handle("skills-set", (event, raw: unknown) => {
    if (!validateSender(event)) return false
    // 写路径防御与 store-set 对齐:限流 + 总大小上限 + 数量上限,防注入渲染端撑爆 store
    if (!storeSetLimiter.allow()) {
      log.warn("IPC rate limited: skills-set")
      return false
    }
    const list = parseSkills(raw)
    if (list.length > SKILL_MAX_COUNT) return false
    const serialized = JSON.stringify(list)
    if (serialized.length > STORE_VALUE_MAX) return false
    getStore().set("skills", serialized)
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

  // ─── 整合模块 IPC Handler（使用 createIpcSecurity 增强校验）─────────
  // createIpcSecurity().handle() 自动执行:发送者验证 + payload 深度/大小检查 + zod schema 解析
  const security = createIpcSecurity({
    ipcMain,
    getMainWindow: deps.getMainWindow,
    devUrl: "http://localhost:5173",
    distHtml: join(__dirname, "../renderer/index.html"),
  })

  // ---- Checkpoints（会话检查点）---------------------------------------
  security.handle(
    "checkpoints:create",
    async (_event, sessionId: unknown, opts: unknown) => {
      return createCheckpoint(sessionId as string, opts as Parameters<typeof createCheckpoint>[1])
    },
    channelSchemas.idTitle,
  )

  security.handle(
    "checkpoints:list",
    (_event, sessionId: unknown) => {
      return listCheckpoints(sessionId as string)
    },
    channelSchemas.id,
  )

  security.handle(
    "checkpoints:get",
    (_event, sessionId: unknown, checkpointId: unknown) => {
      return getCheckpoint(sessionId as string, checkpointId as string)
    },
    channelSchemas.idTitle,
  )

  security.handle(
    "checkpoints:preview-rewind",
    async (_event, sessionId: unknown, checkpointId: unknown) => {
      return previewRewind(sessionId as string, checkpointId as string)
    },
    channelSchemas.idTitle,
  )

  // ---- Skills（文件系统技能管理器）------------------------------------
  // 注意:与已有的 skills-list/skills-set（基于 store）不同,这里是文件系统技能
  security.handle(
    "skills:fs-list",
    (_event, opts: unknown) => {
      return listSkills(opts as { query?: string } | undefined)
    },
    channelSchemas.listOptions,
  )

  security.handle(
    "skills:fs-read",
    (_event, name: unknown) => {
      return readSkill(name as string)
    },
    channelSchemas.id,
  )

  security.handle(
    "skills:fs-system-prompt",
    (_event, names: unknown) => {
      return skillsSystemPrompt(names as string[])
    },
    channelSchemas.skillNames,
  )

  // ---- Plugins（插件管理器）--------------------------------------------
  security.handle("plugins:list", () => pluginManager.listPlugins(), channelSchemas.noArgs)
  security.handle("plugins:discover", () => pluginManager.discoverPlugins(), channelSchemas.noArgs)

  security.handle(
    "plugins:load",
    (_event, name: unknown) => {
      return pluginManager.loadPlugin(name as string)
    },
    channelSchemas.id,
  )

  security.handle(
    "plugins:unload",
    (_event, name: unknown) => {
      return pluginManager.unloadPlugin(name as string)
    },
    channelSchemas.id,
  )

  security.handle(
    "plugins:has-permission",
    (_event, name: unknown, permission: unknown) => {
      return pluginManager.hasPermission(name as string, permission as string)
    },
    channelSchemas.idTitle,
  )

  security.handle("plugins:status", () => pluginManager.getStatus(), channelSchemas.noArgs)

  // ---- Usage Tracker（用量追踪）----------------------------------------
  security.handle("usage:today", () => getTodayUsage(), channelSchemas.noArgs)
  security.handle("usage:summary", () => getUsageSummary(), channelSchemas.noArgs)

  security.handle(
    "usage:daily",
    (_event, date: unknown) => {
      return getDailyUsage(date as string)
    },
    channelSchemas.id,
  )

  security.handle("usage:export", () => exportUsage(), channelSchemas.noArgs)

  security.handle(
    "usage:purge",
    (_event, before: unknown) => {
      return purgeUsageBefore(before as string)
    },
    channelSchemas.id,
  )

  // ---- Marketplace（插件市场）------------------------------------------
  security.handle("marketplace:list", () => listMarketplaces(), channelSchemas.noArgs)
  security.handle("marketplace:installed", () => listInstalledPlugins(), channelSchemas.noArgs)

  security.handle(
    "marketplace:install",
    async (_event, opts: unknown) => {
      return installPlugin(opts as { marketplace: string; name: string })
    },
    channelSchemas.marketplaceInstall,
  )

  security.handle(
    "marketplace:uninstall",
    (_event, opts: unknown) => {
      return uninstallPlugin(opts as { name: string; marketplace?: string })
    },
    channelSchemas.marketplaceUninstall,
  )

  security.handle(
    "marketplace:describe",
    (_event, name: unknown, marketplace: unknown) => {
      return describePlugin(name as string, marketplace as string | undefined)
    },
    channelSchemas.marketplaceDescribe,
  )

  security.handle(
    "marketplace:upgrade",
    async (_event, opts: unknown) => {
      return upgradePlugin(opts as { marketplace: string; name: string })
    },
    channelSchemas.marketplaceUpgrade,
  )

  security.handle(
    "marketplace:update",
    async (_event, nameOrUrl: unknown) => {
      return updateMarketplace(nameOrUrl as string)
    },
    channelSchemas.id,
  )

  // ---- Updater（自动更新）----------------------------------------------
  security.handle("updater:status", async () => getUpdateStatus(), channelSchemas.noArgs)

  security.handle(
    "updater:check",
    async (_event, opts: unknown) => {
      return checkForUpdates(opts as { feedUrl?: string; download?: boolean } | undefined)
    },
    channelSchemas.updaterCheck,
  )

  security.handle("updater:download", async () => downloadUpdate(), channelSchemas.noArgs)
  security.handle("updater:quit-and-install", async () => quitAndInstall(), channelSchemas.noArgs)

  security.handle(
    "updater:set-config",
    (_event, config: unknown) => {
      return setUpdateConfig(
        config as {
          channel?: string
          feedUrl?: string
          autoDownload?: boolean
          autoInstallOnAppQuit?: boolean
        },
      )
    },
    channelSchemas.updaterSetConfig,
  )

  security.handle("updater:wire", async () => wireAutoUpdater(), channelSchemas.noArgs)

  // ─── 多 Agent 协作 ──────────────────────────────────────
  // 所有通道均挂显式契约 schema：新增能力必须先注册契约，禁止动态透传通道。
  // handler 入参保持 unknown，运行时安全由 channelSchemas.multiAgent* 保障。
  security.handle(
    "multi-agent:start",
    async (event, payload: unknown) => {
      const { sessionId, goal } = payload as { sessionId: string; goal: string }
      if (!sessionId || !goal) throw new Error("sessionId and goal are required")

      const session = new CollaborationSession(sessionId, goal)
      const win = BrowserWindow.fromWebContents(event.sender)
      session.setWindow(win)

      // 异步启动，不阻塞 IPC 返回
      session
        .start(event, {
          getWindow: () => BrowserWindow.fromWebContents(event.sender),
          planGoal,
          executeTask,
          reviewResult,
          negotiate,
          ceoDecide,
          synthesize,
        })
        .catch((err) => {
          log.error("[multi-agent] start failed:", err instanceof Error ? err.message : String(err))
        })

      return { sessionId, started: true }
    },
    channelSchemas.multiAgentStart,
  )

  security.handle(
    "multi-agent:get-state",
    (_event, payload: unknown) => {
      const { sessionId } = payload as { sessionId: string }
      const session = getCollaboration(sessionId)
      return session?.getState() ?? null
    },
    channelSchemas.multiAgentId,
  )

  security.handle(
    "multi-agent:abort",
    (_event, payload: unknown) => {
      const { sessionId } = payload as { sessionId: string }
      const session = getCollaboration(sessionId)
      if (session) {
        session.abort()
        return { aborted: true }
      }
      return { aborted: false, reason: "not_found" }
    },
    channelSchemas.multiAgentId,
  )

  security.handle(
    "multi-agent:decision-response",
    (_event, payload: unknown) => {
      const { sessionId, approved, note } = payload as {
        sessionId: string
        approved: boolean
        note?: string
      }
      const session = getCollaboration(sessionId)
      if (session && session.hasPendingDecision) {
        session.resolveDecision(approved, note)
        return { resolved: true }
      }
      return { resolved: false, reason: "no_pending_decision" }
    },
    channelSchemas.multiAgentDecision,
  )

  security.handle("multi-agent:list-history", async () => {
    return listCollaborations()
  })

  security.handle(
    "multi-agent:load-history",
    (_event, payload: unknown) => {
      const { filename } = payload as { filename: string }
      return loadCollaboration(filename)
    },
    channelSchemas.multiAgentFilename,
  )

  security.handle(
    "multi-agent:delete-history",
    (_event, payload: unknown) => {
      const { filename } = payload as { filename: string }
      return deleteCollaboration(filename)
    },
    channelSchemas.multiAgentFilename,
  )
}
