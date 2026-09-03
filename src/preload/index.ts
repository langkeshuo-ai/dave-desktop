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
  ChatStreamStart,
} from "../shared/types"
import type { FileTreeNode } from "../shared/workspace"
import type { FunnelSnapshot, TelemetryEvent, TelemetryEventName } from "../shared/telemetry"
import type { StructuredEvent } from "../shared/structured-log"
import type { McpDiscoveredTool, McpServerConfig } from "../shared/mcp"
import type { SkillDefinition } from "../shared/skills"

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
    onStart: (callback: (data: ChatStreamStart) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: ChatStreamStart) => callback(data)
      ipcRenderer.on("chat-stream-start", handler)
      return () => {
        ipcRenderer.removeListener("chat-stream-start", handler)
      }
    },
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
    /** 导出会话为 Markdown（Codex/Cursor 风格；无消息或会话不存在返回 null）。 */
    exportMarkdown: (id: string) =>
      ipcRenderer.invoke("session:export-markdown", id) as Promise<string | null>,
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

  skills: {
    list: () => ipcRenderer.invoke("skills-list") as Promise<SkillDefinition[]>,
    save: (skills: SkillDefinition[]) =>
      ipcRenderer.invoke("skills-set", skills) as Promise<boolean>,
  },

  telemetry: {
    emit: (name: TelemetryEventName, props?: Record<string, string>) =>
      ipcRenderer.invoke("telemetry-emit", name, props) as Promise<void>,
    funnel: () => ipcRenderer.invoke("telemetry-funnel") as Promise<FunnelSnapshot>,
    events: () => ipcRenderer.invoke("telemetry-events") as Promise<TelemetryEvent[]>,
    clear: () => ipcRenderer.invoke("telemetry-clear") as Promise<void>,
    isFirstRun: () => ipcRenderer.invoke("telemetry-is-first-run") as Promise<boolean>,
  },

  // ─── 整合模块 API（zcode-client → dave-desktop）────────────────────
  checkpoints: {
    create: (sessionId: string, opts: { workspace: string; files: string[]; label?: string }) =>
      ipcRenderer.invoke("checkpoints:create", sessionId, opts) as Promise<{
        id: string
        label: string
        createdAt: string
      }>,
    list: (sessionId: string) =>
      ipcRenderer.invoke("checkpoints:list", sessionId) as Promise<
        Array<{ id: string; label: string; createdAt: string; fileCount: number }>
      >,
    get: (sessionId: string, checkpointId: string) =>
      ipcRenderer.invoke("checkpoints:get", sessionId, checkpointId) as Promise<unknown>,
    previewRewind: (sessionId: string, checkpointId: string) =>
      ipcRenderer.invoke("checkpoints:preview-rewind", sessionId, checkpointId) as Promise<unknown>,
  },

  skillsFs: {
    list: (opts?: { query?: string }) =>
      ipcRenderer.invoke("skills:fs-list", opts) as Promise<
        Array<{ name: string; description: string; path: string }>
      >,
    read: (name: string) =>
      ipcRenderer.invoke("skills:fs-read", name) as Promise<{
        name: string
        meta: Record<string, unknown>
        body: string
      } | null>,
    systemPrompt: (names: string[]) =>
      ipcRenderer.invoke("skills:fs-system-prompt", names) as Promise<string>,
  },

  plugins: {
    list: () =>
      ipcRenderer.invoke("plugins:list") as Promise<
        Array<{ name: string; version: string; description: string; status: string }>
      >,
    discover: () =>
      ipcRenderer.invoke("plugins:discover") as Promise<
        Array<{ name: string; version: string; description: string; status: string }>
      >,
    load: (name: string) =>
      ipcRenderer.invoke("plugins:load", name) as Promise<{ name: string; status: string }>,
    unload: (name: string) => ipcRenderer.invoke("plugins:unload", name) as Promise<boolean>,
    hasPermission: (name: string, permission: string) =>
      ipcRenderer.invoke("plugins:has-permission", name, permission) as Promise<boolean>,
    status: () => ipcRenderer.invoke("plugins:status") as Promise<Record<string, unknown>>,
  },

  usage: {
    today: () => ipcRenderer.invoke("usage:today") as Promise<Record<string, unknown>>,
    summary: () => ipcRenderer.invoke("usage:summary") as Promise<Record<string, unknown>>,
    daily: (date: string) =>
      ipcRenderer.invoke("usage:daily", date) as Promise<Record<string, unknown>>,
    export: () => ipcRenderer.invoke("usage:export") as Promise<string>,
    purge: (before: string) => ipcRenderer.invoke("usage:purge", before) as Promise<number>,
  },

  marketplace: {
    list: () =>
      ipcRenderer.invoke("marketplace:list") as Promise<{
        catalogs: Array<{ id: string; name: string; pluginCount: number }>
        known: Record<string, unknown>
      }>,
    installed: () =>
      ipcRenderer.invoke("marketplace:installed") as Promise<{
        plugins: Array<{ name: string; version: string; marketplace: string }>
      }>,
    install: (opts: { marketplace: string; name: string }) =>
      ipcRenderer.invoke("marketplace:install", opts) as Promise<{
        name: string
        version: string
        marketplace: string
        installPath: string
      }>,
    upgrade: (opts: { marketplace: string; name: string }) =>
      ipcRenderer.invoke("marketplace:upgrade", opts) as Promise<{
        name: string
        version: string
        marketplace: string
        installPath: string
      }>,
    uninstall: (opts: { name: string; marketplace?: string }) =>
      ipcRenderer.invoke("marketplace:uninstall", opts) as Promise<{ ok: boolean }>,
    describe: (name: string, marketplace?: string) =>
      ipcRenderer.invoke("marketplace:describe", name, marketplace) as Promise<
        Record<string, unknown>
      >,
    update: (nameOrUrl: string) =>
      ipcRenderer.invoke("marketplace:update", nameOrUrl) as Promise<{ ok: boolean }>,
  },

  updater: {
    status: () => ipcRenderer.invoke("updater:status") as Promise<Record<string, unknown>>,
    check: (opts?: { feedUrl?: string }) =>
      ipcRenderer.invoke("updater:check", opts) as Promise<Record<string, unknown>>,
    download: () =>
      ipcRenderer.invoke("updater:download") as Promise<{ ok: boolean; message?: string }>,
    quitAndInstall: () =>
      ipcRenderer.invoke("updater:quit-and-install") as Promise<{ ok: boolean; message?: string }>,
    setConfig: (config: { channel?: string; autoDownload?: boolean; feedUrl?: string }) =>
      ipcRenderer.invoke("updater:set-config", config) as Promise<Record<string, unknown>>,
    wire: () => ipcRenderer.invoke("updater:wire") as Promise<{ wired: boolean }>,
  },

  multiAgent: {
    start: (sessionId: string, goal: string) =>
      ipcRenderer.invoke("multi-agent:start", { sessionId, goal }) as Promise<{
        sessionId: string
        started: boolean
      }>,
    getState: (sessionId: string) =>
      ipcRenderer.invoke("multi-agent:get-state", { sessionId }) as Promise<Record<
        string,
        unknown
      > | null>,
    abort: (sessionId: string) =>
      ipcRenderer.invoke("multi-agent:abort", { sessionId }) as Promise<{
        aborted: boolean
        reason?: string
      }>,
    respondDecision: (sessionId: string, approved: boolean, note?: string) =>
      ipcRenderer.invoke("multi-agent:decision-response", {
        sessionId,
        approved,
        note,
      }) as Promise<{ resolved: boolean; reason?: string }>,
    listHistory: () =>
      ipcRenderer.invoke("multi-agent:list-history") as Promise<Array<Record<string, unknown>>>,
    loadHistory: (filename: string) =>
      ipcRenderer.invoke("multi-agent:load-history", { filename }) as Promise<Record<
        string,
        unknown
      > | null>,
    deleteHistory: (filename: string) =>
      ipcRenderer.invoke("multi-agent:delete-history", { filename }) as Promise<boolean>,
    onDecisionRequest: (
      callback: (data: {
        sessionId: string
        checkpoint: Record<string, unknown>
        question: string
        options: string[]
      }) => void,
    ) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: {
          sessionId: string
          checkpoint: Record<string, unknown>
          question: string
          options: string[]
        },
      ) => callback(data)
      ipcRenderer.on("multi-agent:decision-request", handler)
      return () => ipcRenderer.removeListener("multi-agent:decision-request", handler)
    },
    onStage: (
      callback: (data: {
        sessionId: string
        stage: string
        stageInfo: Record<string, unknown>
      }) => void,
    ) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { sessionId: string; stage: string; stageInfo: Record<string, unknown> },
      ) => callback(data)
      ipcRenderer.on("multi-agent:stage", handler)
      return () => ipcRenderer.removeListener("multi-agent:stage", handler)
    },
    onCheckpoint: (
      callback: (data: { sessionId: string; checkpoint: Record<string, unknown> }) => void,
    ) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { sessionId: string; checkpoint: Record<string, unknown> },
      ) => callback(data)
      ipcRenderer.on("multi-agent:checkpoint", handler)
      return () => ipcRenderer.removeListener("multi-agent:checkpoint", handler)
    },
    onMessage: (
      callback: (data: { sessionId: string; message: Record<string, unknown> }) => void,
    ) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { sessionId: string; message: Record<string, unknown> },
      ) => callback(data)
      ipcRenderer.on("multi-agent:message", handler)
      return () => ipcRenderer.removeListener("multi-agent:message", handler)
    },
    onTask: (callback: (data: { sessionId: string; task: Record<string, unknown> }) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { sessionId: string; task: Record<string, unknown> },
      ) => callback(data)
      ipcRenderer.on("multi-agent:task", handler)
      return () => ipcRenderer.removeListener("multi-agent:task", handler)
    },
    onCanvas: (
      callback: (data: { sessionId: string; canvas: Record<string, unknown> }) => void,
    ) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { sessionId: string; canvas: Record<string, unknown> },
      ) => callback(data)
      ipcRenderer.on("multi-agent:canvas", handler)
      return () => ipcRenderer.removeListener("multi-agent:canvas", handler)
    },
    onComplete: (
      callback: (data: {
        sessionId: string
        result: string
        checkpoints: Record<string, unknown>[]
        artifactPath?: string
      }) => void,
    ) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: {
          sessionId: string
          result: string
          checkpoints: Record<string, unknown>[]
          artifactPath?: string
        },
      ) => callback(data)
      ipcRenderer.on("multi-agent:complete", handler)
      return () => ipcRenderer.removeListener("multi-agent:complete", handler)
    },
  },
}

contextBridge.exposeInMainWorld("dave", api)

export type DaveApi = typeof api
// NOTE: Do not `export default api` here. rollup cjs output would append
// `module.exports = api`, but Electron sandbox preload scripts drop
// `module.exports` and the binding is meaningless; the real surface is
// `contextBridge.exposeInMainWorld("dave", api)` above. Keeping only the
// type export also lets renderer imports use `import type { DaveApi }`.
