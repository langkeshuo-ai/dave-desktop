/**
 * Updater Service — 自动更新服务
 *
 * 从 zcode-client 的 updater.mjs 迁移，TypeScript 重写，Dave 品牌。
 *
 * 核心能力：
 * 1. wireAutoUpdater — 连接 electron-updater，监听更新事件
 * 2. getUpdateStatus — 获取当前更新状态
 * 3. checkForUpdates — 检查更新（开发模式检查 feed 元数据，打包模式用 electron-updater）
 * 4. downloadUpdate — 下载更新
 * 5. quitAndInstall — 退出并安装更新
 * 6. setUpdateConfig — 设置更新配置（channel/feedUrl/autoDownload）
 *
 * 安全设计：
 * - 更新源必须使用 HTTPS（开发模式允许 localhost HTTP）
 * - 生产模式下 feedUrl 不可在运行时更改
 * - feed URL 自动清除 username/password/hash
 */
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { clientDataRoot, ensureDir } from "../utils/paths"

// ─── 常量 ────────────────────────────────────────────────

const require = createRequire(import.meta.url)
const PRODUCTION_FEED_URL = "https://updates.dave.dev/dave-desktop/"
let updaterWired = false

// ─── 类型 ────────────────────────────────────────────────

export interface UpdateState {
  lastCheckedAt: number | null
  lastResult: UpdateCheckResult | null
  channel: string
  feedUrl: string
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  lastEvent?: { type: string; at: number; [key: string]: unknown }
  updatedAt?: number
}

export interface UpdateCheckResult {
  status: "dev-mode" | "skeleton" | "checked" | "error"
  message?: string
  currentVersion: string
  feedUrl: string | null
  feedMeta: FeedMeta | null
  updateAvailable: boolean
  updateInfo?: unknown
}

export interface FeedMeta {
  version?: string
  artifact?: string
  raw?: string
  error?: string
  [key: string]: unknown
}

export interface UpdateConfigPatch {
  channel?: string
  feedUrl?: string
  autoDownload?: boolean
  autoInstallOnAppQuit?: boolean
}

export interface WireResult {
  wired: boolean
  reason?: string
  feedUrl?: string
}

type SendFn = (channel: string, payload: unknown) => void

// ─── 工具函数 ────────────────────────────────────────────

function validateFeedUrl(value: string, options: { allowLocalhost?: boolean } = {}): string {
  const url = new URL(value)
  const isLocalhost = url.hostname === "127.0.0.1" || url.hostname === "localhost"
  if (
    url.protocol !== "https:" &&
    !(options.allowLocalhost && isLocalhost && url.protocol === "http:")
  ) {
    throw new Error("Update feed must use HTTPS")
  }
  url.username = ""
  url.password = ""
  url.hash = ""
  return url.href
}

function getElectronApp(): { getVersion: () => string; isPackaged: boolean } | null {
  try {
    return require("electron").app
  } catch {
    return null
  }
}

function appVersion(): string {
  const app = getElectronApp()
  if (app?.getVersion) return app.getVersion()
  try {
    return require("../../package.json").version
  } catch {
    return "0.0.0"
  }
}

function appIsPackaged(): boolean {
  const app = getElectronApp()
  return Boolean(app?.isPackaged)
}

function stateFile(): string {
  return path.join(clientDataRoot(), "update-state.json")
}

function defaultFeedUrl(): string {
  if (appIsPackaged()) return PRODUCTION_FEED_URL
  if (process.env.DAVE_DESKTOP_UPDATE_URL) {
    return validateFeedUrl(process.env.DAVE_DESKTOP_UPDATE_URL, { allowLocalhost: true })
  }
  try {
    const feedCfg = path.join(clientDataRoot(), "update-feed.json")
    if (fs.existsSync(feedCfg)) {
      const j = JSON.parse(fs.readFileSync(feedCfg, "utf8")) as { feedUrl?: string }
      if (j.feedUrl) return validateFeedUrl(j.feedUrl, { allowLocalhost: true })
    }
  } catch {
    // Invalid development override falls through to localhost.
  }
  return "http://127.0.0.1:8788/"
}

function effectiveFeedUrl(requested?: string): string {
  if (appIsPackaged()) return PRODUCTION_FEED_URL
  return validateFeedUrl(requested || defaultFeedUrl(), { allowLocalhost: true })
}

// ─── 状态读写 ─────────────────────────────────────────────

function readState(): UpdateState {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8")) as UpdateState
  } catch {
    return {
      lastCheckedAt: null,
      lastResult: null,
      channel: "stable",
      feedUrl: defaultFeedUrl(),
      autoDownload: true,
      autoInstallOnAppQuit: true,
    }
  }
}

function writeState(patch: Partial<UpdateState>): UpdateState {
  ensureDir(clientDataRoot())
  const next: UpdateState = { ...readState(), ...patch, updatedAt: Date.now() }
  fs.writeFileSync(stateFile(), JSON.stringify(next, null, 2), "utf8")
  return next
}

// ─── electron-updater 加载 ────────────────────────────────

async function tryLoadElectronUpdater(): Promise<{
  autoUpdater: {
    setFeedURL: (opts: { provider: string; url: string }) => void
    autoDownload: boolean
    autoInstallOnAppQuit: boolean
    on: (event: string, handler: (...args: unknown[]) => void) => void
    checkForUpdates: () => Promise<{ updateInfo?: unknown }>
    downloadUpdate: () => Promise<void>
    quitAndInstall: (isSilent: boolean, isForceRunAfter: boolean) => void
  }
} | null> {
  try {
    const mod = await import("electron-updater")
    return { autoUpdater: (mod as { autoUpdater: unknown }).autoUpdater as never }
  } catch {
    return null
  }
}

// ─── Feed 元数据获取 ──────────────────────────────────────

async function fetchFeedMeta(url: string): Promise<FeedMeta | null> {
  if (!url) return null
  try {
    const base = url.endsWith("/") ? url : `${url}/`
    const res = await fetch(`${base}feed.json`, { signal: AbortSignal.timeout(5000) })
    if (res.ok) return (await res.json()) as FeedMeta
    // fallback latest.yml parse lightly
    const ymlRes = await fetch(`${base}latest.yml`, { signal: AbortSignal.timeout(5000) })
    if (!ymlRes.ok) return { error: `feed status ${res.status}` }
    const text = await ymlRes.text()
    const version = (text.match(/^version:\s*(.+)$/m) || [])[1]?.trim()
    const artifact = (text.match(/^path:\s*(.+)$/m) || [])[1]?.trim()
    return { version, artifact, raw: text.slice(0, 500) }
  } catch (err) {
    return { error: String(err instanceof Error ? err.message : err) }
  }
}

// ─── 核心 API ─────────────────────────────────────────────

/**
 * 连接 electron-updater，监听更新事件并通过 IPC 推送到 Renderer。
 * 仅在打包模式下生效。
 */
export async function wireAutoUpdater(send?: SendFn): Promise<WireResult> {
  if (updaterWired || !appIsPackaged()) return { wired: false }
  const loaded = await tryLoadElectronUpdater()
  if (!loaded) return { wired: false, reason: "electron-updater missing" }
  const { autoUpdater } = loaded
  const state = readState()
  const url = effectiveFeedUrl(state.feedUrl)
  if (url) autoUpdater.setFeedURL({ provider: "generic", url })
  autoUpdater.autoDownload = state.autoDownload !== false
  autoUpdater.autoInstallOnAppQuit = state.autoInstallOnAppQuit !== false

  const emit = (type: string, payload: Record<string, unknown> = {}): void => {
    writeState({ lastEvent: { type, ...payload, at: Date.now() } })
    send?.("update:event", { type, ...payload })
  }

  autoUpdater.on("checking-for-update", () => emit("checking-for-update"))
  autoUpdater.on("update-available", (info: unknown) => emit("update-available", { info }))
  autoUpdater.on("update-not-available", (info: unknown) => emit("update-not-available", { info }))
  autoUpdater.on("error", (err: unknown) =>
    emit("error", { message: String(err instanceof Error ? err.message : err) }),
  )
  autoUpdater.on("download-progress", (p: unknown) => {
    const prog = p as {
      percent: number
      transferred: number
      total: number
      bytesPerSecond: number
    }
    emit("download-progress", {
      percent: prog.percent,
      transferred: prog.transferred,
      total: prog.total,
      bytesPerSecond: prog.bytesPerSecond,
    })
  })
  autoUpdater.on("update-downloaded", (info: unknown) => emit("update-downloaded", { info }))

  updaterWired = true
  return { wired: true, feedUrl: url }
}

/** 获取当前更新状态 */
export async function getUpdateStatus(): Promise<
  UpdateState & { currentVersion: string; isPackaged: boolean; provider: string; notes: string }
> {
  const state = readState()
  return {
    ...state,
    currentVersion: appVersion(),
    isPackaged: appIsPackaged(),
    provider: "generic",
    notes:
      "Packaged builds use electron-updater against feedUrl. Dev mode checks feed metadata only. Use downloadUpdate/quitAndInstall when packaged.",
  }
}

/**
 * 检查更新。
 * 开发模式：仅检查 feed 元数据，不下载不安装。
 * 打包模式：使用 electron-updater 检查。
 */
export async function checkForUpdates(
  options: { feedUrl?: string; download?: boolean } = {},
): Promise<UpdateCheckResult> {
  const state = readState()
  const url = effectiveFeedUrl(options.feedUrl || state.feedUrl)
  writeState({ lastCheckedAt: Date.now(), feedUrl: url })
  const feedMeta = await fetchFeedMeta(url)

  const updateAvailable =
    Boolean(feedMeta?.version) &&
    String(feedMeta?.version) !== String(appVersion()) &&
    !feedMeta?.error

  if (!appIsPackaged()) {
    const result: UpdateCheckResult = {
      status: "dev-mode",
      message:
        "Install/update apply is disabled in unpackaged/dev mode; feed metadata still checked",
      currentVersion: appVersion(),
      feedUrl: url || null,
      feedMeta,
      updateAvailable,
    }
    writeState({ lastResult: result })
    return result
  }

  const loaded = await tryLoadElectronUpdater()
  if (!loaded) {
    const result: UpdateCheckResult = {
      status: "skeleton",
      message: "electron-updater not installed",
      currentVersion: appVersion(),
      feedUrl: url || null,
      feedMeta,
      updateAvailable,
    }
    writeState({ lastResult: result })
    return result
  }

  const { autoUpdater } = loaded
  if (url) autoUpdater.setFeedURL({ provider: "generic", url })
  autoUpdater.autoDownload =
    options.download != null ? Boolean(options.download) : state.autoDownload !== false
  try {
    const updateCheck = await autoUpdater.checkForUpdates()
    const result: UpdateCheckResult = {
      status: "checked",
      currentVersion: appVersion(),
      updateInfo: updateCheck?.updateInfo || null,
      feedUrl: url || null,
      feedMeta,
      updateAvailable:
        updateAvailable ||
        Boolean(
          (updateCheck?.updateInfo as { version?: string } | null)?.version &&
          (updateCheck.updateInfo as { version: string }).version !== appVersion(),
        ),
    }
    writeState({ lastResult: result })
    return result
  } catch (err) {
    const result: UpdateCheckResult = {
      status: "error",
      message: String(err instanceof Error ? err.message : err),
      currentVersion: appVersion(),
      feedUrl: url || null,
      feedMeta,
      updateAvailable,
    }
    writeState({ lastResult: result })
    return result
  }
}

/** 下载更新（仅打包模式） */
export async function downloadUpdate(): Promise<{
  ok: boolean
  message?: string
  status?: string
}> {
  if (!appIsPackaged()) {
    return { ok: false, message: "downloadUpdate only works in packaged builds" }
  }
  const loaded = await tryLoadElectronUpdater()
  if (!loaded) return { ok: false, message: "electron-updater missing" }
  const { autoUpdater } = loaded
  const state = readState()
  autoUpdater.setFeedURL({ provider: "generic", url: effectiveFeedUrl(state.feedUrl) })
  await autoUpdater.downloadUpdate()
  const result = { ok: true, status: "downloading-or-downloaded" }
  writeState({ lastResult: { ...readState().lastResult, download: result } as UpdateCheckResult })
  return result
}

/** 退出并安装更新（仅打包模式） */
export async function quitAndInstall(): Promise<{ ok: boolean; message?: string }> {
  if (!appIsPackaged()) {
    return { ok: false, message: "quitAndInstall only works in packaged builds" }
  }
  const loaded = await tryLoadElectronUpdater()
  if (!loaded) return { ok: false, message: "electron-updater missing" }
  const { autoUpdater } = loaded
  autoUpdater.quitAndInstall(false, true)
  return { ok: true }
}

/**
 * 设置更新配置。
 * 生产模式下 feedUrl 不可更改（强制使用 PRODUCTION_FEED_URL）。
 */
export function setUpdateConfig(patch: UpdateConfigPatch = {}): UpdateState {
  const current = readState()
  if (appIsPackaged() && patch.feedUrl && patch.feedUrl !== PRODUCTION_FEED_URL) {
    throw new Error("Production update feed cannot be changed at runtime")
  }
  return writeState({
    channel: patch.channel || current.channel,
    feedUrl: effectiveFeedUrl(patch.feedUrl ?? current.feedUrl),
    autoDownload: patch.autoDownload ?? current.autoDownload,
    autoInstallOnAppQuit: patch.autoInstallOnAppQuit ?? current.autoInstallOnAppQuit,
  })
}
