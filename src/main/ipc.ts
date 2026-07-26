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
import { getSecure, setSecure } from "./store"

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

// Idempotency guard — electron-vite CJS-shim can re-run this module.
let registered = false

/** 校验 IPC sender 是否来自主窗口的渲染进程。
 *  防止其他窗口或子进程绕过白名单发送 IPC 消息。
 *  仅在生产构建中启用严格校验,开发模式允许 localhost 调试连接。 */
export function validateSender(event: { sender: { id?: number } }): boolean {
  if (!app.isPackaged) return true // 开发模式放行(DevTools 等调试连接)
  const win = BrowserWindow.getAllWindows().find((w) => w.webContents.id === event.sender.id)
  if (!win) {
    log.warn("IPC sender validation failed: sender webContents.id not found in any window")
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

  ipcMain.handle("store-keys", () => {
    const s = getStore() as { store: Record<string, unknown> }
    // 只返回白名单内的 key,避免泄露 API key 名称等敏感字段名。
    return Object.keys(s.store).filter((k) => isAllowedStoreKey(k))
  })

  ipcMain.handle("show-window", () => {
    deps.showWindow()
  })

  ipcMain.handle(
    "open-directory-picker",
    async (_event, opts?: { title?: string; defaultPath?: string }) => {
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
    async (_event, opts?: { title?: string; extensions?: string[] }) => {
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

  ipcMain.handle("open-link", (_event, url: string) => {
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

  ipcMain.handle("show-notification", (_event, title: string, body?: string) => {
    if (!Notification.isSupported()) return false
    new Notification({ title, body }).show()
    return true
  })

  ipcMain.handle("get-platform", () => process.platform)
  ipcMain.handle("get-version", () => app.getVersion())

  ipcMain.handle("open-settings", () => {
    const win = deps.getMainWindow()
    if (win) win.webContents.send("menu-action", "open-settings")
  })

  ipcMain.handle("auto-launch-get", () => autoLaunch.isEnabled())
  ipcMain.handle("auto-launch-set", (_event, enabled: boolean) => autoLaunch.setEnabled(enabled))

  ipcMain.handle("chat-approve", (event, sessionId: string, approved: boolean) => {
    if (!validateSender(event)) return
    resolveApproval(sessionId, approved)
  })

  ipcMain.handle("chat-stream", async (event, message: string, sessionId: string) => {
    if (!validateSender(event)) return
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

  ipcMain.handle("session-list", () => getSessionList())
  ipcMain.handle("session-get", (event, sessionId: string) => {
    if (!validateSender(event)) return null
    return getSession(sessionId)
  })
  ipcMain.handle("session-create", () => createSession())
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
    const workspace = (getStore().get("cwd") as string) || ""
    if (!workspace) throw new Error("工作区未配置")
    if (!diff?.trim()) throw new Error("空 diff")
    const result = await applyWorkspaceDiff(workspace, diff)
    return { ok: result.ok, output: result.output, paths: result.paths ?? [] }
  })

  ipcMain.handle("open-log-dir", async () => {
    const dir = app.getPath("userData")
    await shell.openPath(dir)
    return dir
  })

  // ---- 本地遥测(无第三方,只存 electron-store) ------------------------
  // 设计:fire-and-forget,失败静默;不在主路径上阻塞业务。
  ipcMain.handle("telemetry-emit", (_event, name: string, props?: Record<string, string>) => {
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
  ipcMain.handle("telemetry-funnel", () => getFunnelSnapshot())
  ipcMain.handle("telemetry-events", () => readEvents())
  ipcMain.handle("telemetry-clear", () => {
    clearEvents()
  })
  ipcMain.handle("telemetry-is-first-run", () => isFirstRun())
}
