import { contextBridge, ipcRenderer } from "electron"
import type {
  ChatMessage,
  FilePickerResult,
  Session,
  SessionData,
  ChatStreamChunk,
  ChatStreamDone,
  ChatStreamError,
  ChatStreamApproval,
  ChatStreamPatch,
  ChatStreamTools,
} from "../shared/types"
import type { FileTreeNode } from "../shared/workspace"
import type { FunnelSnapshot, TelemetryEvent, TelemetryEventName } from "../shared/telemetry"
import type { StructuredEvent } from "../shared/structured-log"
import type { McpDiscoveredTool, McpServerConfig } from "../shared/mcp"

const api = {
  store: {
    get: (key: string) => ipcRenderer.invoke("store-get", key) as Promise<string | null>,
    set: (key: string, value: string) =>
      ipcRenderer.invoke("store-set", key, value) as Promise<void>,
    delete: (key: string) => ipcRenderer.invoke("store-delete", key) as Promise<void>,
    keys: () => ipcRenderer.invoke("store-keys") as Promise<string[]>,
  },

  window: {
    show: () => ipcRenderer.invoke("show-window") as Promise<void>,
  },

  dialog: {
    openDirectory: (opts?: { title?: string; defaultPath?: string }) =>
      ipcRenderer.invoke("open-directory-picker", opts) as Promise<string | null>,
    openFile: (opts?: { title?: string; extensions?: string[] }) =>
      ipcRenderer.invoke("open-file-picker", opts) as Promise<FilePickerResult | null>,
  },

  shell: {
    openLink: (url: string) => ipcRenderer.invoke("open-link", url) as Promise<void>,
  },

  notification: {
    show: (title: string, body?: string) =>
      ipcRenderer.invoke("show-notification", title, body) as Promise<boolean>,
  },

  platform: () => ipcRenderer.invoke("get-platform") as Promise<string>,
  version: () => ipcRenderer.invoke("get-version") as Promise<string>,

  autoLaunch: {
    get: () => ipcRenderer.invoke("auto-launch-get") as Promise<boolean>,
    set: (enabled: boolean) => ipcRenderer.invoke("auto-launch-set", enabled) as Promise<boolean>,
  },

  chat: {
    stream: (message: string, sessionId: string) =>
      ipcRenderer.invoke("chat-stream", message, sessionId) as Promise<void>,
    abort: (sessionId: string) => ipcRenderer.invoke("chat-abort", sessionId) as Promise<void>,
    approve: (sessionId: string, approved: boolean) =>
      ipcRenderer.invoke("chat-approve", sessionId, approved) as Promise<void>,
    onChunk: (callback: (data: ChatStreamChunk) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: ChatStreamChunk) => callback(data)
      ipcRenderer.on("chat-stream-chunk", handler)
      return () => {
        ipcRenderer.removeListener("chat-stream-chunk", handler)
      }
    },
    onDone: (callback: (data: ChatStreamDone) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: ChatStreamDone) => callback(data)
      ipcRenderer.on("chat-stream-done", handler)
      return () => {
        ipcRenderer.removeListener("chat-stream-done", handler)
      }
    },
    onError: (callback: (data: ChatStreamError) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: ChatStreamError) => callback(data)
      ipcRenderer.on("chat-stream-error", handler)
      return () => {
        ipcRenderer.removeListener("chat-stream-error", handler)
      }
    },
    onApproval: (callback: (req: ChatStreamApproval) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, req: ChatStreamApproval) => callback(req)
      ipcRenderer.on("chat-stream-approval", handler)
      return () => {
        ipcRenderer.removeListener("chat-stream-approval", handler)
      }
    },
    onPatch: (callback: (data: ChatStreamPatch) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: ChatStreamPatch) => callback(data)
      ipcRenderer.on("chat-stream-patch", handler)
      return () => {
        ipcRenderer.removeListener("chat-stream-patch", handler)
      }
    },
    onTools: (callback: (data: ChatStreamTools) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: ChatStreamTools) => callback(data)
      ipcRenderer.on("chat-stream-tools", handler)
      return () => {
        ipcRenderer.removeListener("chat-stream-tools", handler)
      }
    },
  },

  session: {
    list: () => ipcRenderer.invoke("session-list") as Promise<Session[]>,
    get: (id: string) => ipcRenderer.invoke("session-get", id) as Promise<SessionData>,
    create: () => ipcRenderer.invoke("session-create") as Promise<string>,
    delete: (id: string) => ipcRenderer.invoke("session-delete", id) as Promise<void>,
    updateTitle: (id: string, title: string) =>
      ipcRenderer.invoke("session-update-title", id, title) as Promise<void>,
    /** 编辑/再生成截断后整表写回会话消息。 */
    replaceMessages: (id: string, messages: ChatMessage[]) =>
      ipcRenderer.invoke("session-replace-messages", id, messages) as Promise<boolean>,
  },

  provider: {
    probe: (opts: {
      provider: string
      apiKey: string
      model?: string
      customHost?: string
      customModel?: string
    }) =>
      ipcRenderer.invoke("provider-probe", opts) as Promise<{
        ok: boolean
        latencyMs: number
        message: string
      }>,
  },

  menu: {
    onAction: (callback: (action: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, action: string) => callback(action)
      ipcRenderer.on("menu-action", handler)
      return () => {
        ipcRenderer.removeListener("menu-action", handler)
      }
    },
  },

  workspace: {
    fileTree: (opts?: { depth?: number }) =>
      ipcRenderer.invoke("workspace-file-tree", opts) as Promise<FileTreeNode[]>,
    applyPatch: (diff: string) =>
      ipcRenderer.invoke("workspace-apply-patch", diff) as Promise<{
        ok: boolean
        output: string
        paths: string[]
      }>,
  },

  logs: {
    openDir: () => ipcRenderer.invoke("open-log-dir") as Promise<string>,
    readStructured: (limit?: number) =>
      ipcRenderer.invoke("logs-read-structured", { limit }) as Promise<StructuredEvent[]>,
    setLevel: (level: "debug" | "info" | "warn" | "error") =>
      ipcRenderer.invoke("logs-set-level", level) as Promise<boolean>,
  },

  diagnostics: {
    export: () => ipcRenderer.invoke("diagnostics-export") as Promise<string | null>,
  },

  mcp: {
    listTools: () => ipcRenderer.invoke("mcp-list-tools") as Promise<McpDiscoveredTool[]>,
    saveServers: (configs: McpServerConfig[]) =>
      ipcRenderer.invoke("mcp-servers-set", configs) as Promise<boolean>,
  },

  telemetry: {
    emit: (name: TelemetryEventName, props?: Record<string, string>) =>
      ipcRenderer.invoke("telemetry-emit", name, props) as Promise<void>,
    funnel: () => ipcRenderer.invoke("telemetry-funnel") as Promise<FunnelSnapshot>,
    events: () => ipcRenderer.invoke("telemetry-events") as Promise<TelemetryEvent[]>,
    clear: () => ipcRenderer.invoke("telemetry-clear") as Promise<void>,
    isFirstRun: () => ipcRenderer.invoke("telemetry-is-first-run") as Promise<boolean>,
  },
}

contextBridge.exposeInMainWorld("dave", api)

export type DaveApi = typeof api
// NOTE: Do not `export default api` here. rollup cjs output would append
// `module.exports = api`, but Electron sandbox preload scripts drop
// `module.exports` and the binding is meaningless; the real surface is
// `contextBridge.exposeInMainWorld("dave", api)` above. Keeping only the
// type export also lets renderer imports use `import type { DaveApi }`.
