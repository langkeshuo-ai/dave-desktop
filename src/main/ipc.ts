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
import { clearEvents, getFunnelSnapshot, isFirstRun, readEvents, trackEvent } from "./telemetry-store"
import { TELEMETRY_EVENT_NAMES, type TelemetryEventName } from "../shared/telemetry"

// 白名单 Set:O(1) 查找,防止渲染端注入未知事件名。
const TELEMETRY_NAME_SET: Set<string> = new Set(TELEMETRY_EVENT_NAMES)
function isKnownTelemetryEvent(name: string): name is TelemetryEventName {
  return TELEMETRY_NAME_SET.has(name)
}

type Deps = {
  getMainWindow: () => BrowserWindow | null
  showWindow: () => void
}

// Idempotency guard — electron-vite CJS-shim can re-run this module.
let registered = false

export function registerIpcHandlers(deps: Deps) {
  if (registered) {
    log.warn("registerIpcHandlers called twice — skipping duplicate IPC registration")
    return
  }
  registered = true

  ipcMain.handle("store-get", (_event, key: string) => {
    const v = getStore().get(key)
    return v ?? null
  })

  ipcMain.handle("store-set", (_event, key: string, value: string) => {
    getStore().set(key, value)
  })

  ipcMain.handle("store-delete", (_event, key: string) => {
    getStore().delete(key)
  })

  ipcMain.handle("store-keys", () => {
    const s = getStore() as { store: Record<string, unknown> }
    return Object.keys(s.store)
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
        filters: opts?.extensions
          ? [{ name: "Files", extensions: opts.extensions }]
          : undefined,
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
  ipcMain.handle("auto-launch-set", (_event, enabled: boolean) =>
    autoLaunch.setEnabled(enabled),
  )

  ipcMain.handle("chat-approve", (_event, sessionId: string, approved: boolean) => {
    resolveApproval(sessionId, approved)
  })

  ipcMain.handle("chat-stream", async (event, message: string, sessionId: string) => {
    await handleChatStream(event, message, sessionId)
  })

  ipcMain.handle("chat-abort", (_event, sessionId: string) => {
    abortSession(sessionId)
  })

  ipcMain.handle("workspace-file-tree", async (_event, opts?: { depth?: number }) => {
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
  ipcMain.handle("session-get", (_event, sessionId: string) => getSession(sessionId))
  ipcMain.handle("session-create", () => createSession())
  ipcMain.handle("session-delete", (_event, sessionId: string) => {
    deleteSession(sessionId)
  })
  ipcMain.handle("session-update-title", (_event, sessionId: string, title: string) => {
    updateSessionTitle(sessionId, title)
  })

  ipcMain.handle(
    "provider-probe",
    async (
      _event,
      opts: {
        provider: string
        apiKey: string
        model?: string
        customHost?: string
        customModel?: string
      },
    ) => probeProviderConnection(opts),
  )

  ipcMain.handle("workspace-apply-patch", async (_event, diff: string) => {
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
  ipcMain.handle(
    "telemetry-emit",
    (_event, name: string, props?: Record<string, string>) => {
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
    },
  )
  ipcMain.handle("telemetry-funnel", () => getFunnelSnapshot())
  ipcMain.handle("telemetry-events", () => readEvents())
  ipcMain.handle("telemetry-clear", () => {
    clearEvents()
  })
  ipcMain.handle("telemetry-is-first-run", () => isFirstRun())
}
