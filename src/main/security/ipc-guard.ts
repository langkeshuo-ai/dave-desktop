/**
 * IPC Security Guard — IPC 安全守卫
 *
 * 从 zcode-client 的 ipc-security.mjs 迁移，TypeScript 重写。
 * 核心能力：
 * 1. assertTrustedSender — 验证发送者是主窗口主 frame 且 origin 可信
 * 2. inspectValue — 递归检查 payload（深度/大小/循环/危险键/纯对象）
 * 3. createIpcSecurity — 创建安全上下文，提供 handle 包装器
 * 4. assertAllowedShellPath — 验证路径在受信任根目录内
 *
 * 与 dave-desktop 现有 validateSender 的关系：
 * - 现有 validateSender 做基础的窗口/frame/URL 检查
 * - 本模块增加 payload 深度检查、zod schema 校验、路径信任根验证
 * - 两者互补，逐步替换现有内联校验
 */
import type { IpcMain, IpcMainInvokeEvent, BrowserWindow } from "electron"
import path from "node:path"
import { z } from "zod"
import { createRateLimiter } from "../../shared/rate-limit"
import { createChatStreamState } from "../../shared/chat-stream-state"
import type { ChatStreamState, StreamEvent } from "../../shared/chat-stream-state"

// ─── 常量 ────────────────────────────────────────────────

export const MAX_IPC_DEPTH = 12
export const MAX_IPC_KEYS = 500
export const MAX_IPC_STRING = 1_000_000
export const MAX_IPC_ARRAY = 10_000
export const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"])

// ─── Zod Schemas ─────────────────────────────────────────

export const ipcArgsSchema = z.array(z.unknown()).max(20)

const idSchema = z.string().min(1).max(256)
const shortTextSchema = z.string().max(512)
const workspacePathSchema = z.string().min(1).max(32_768)
const httpsUrlSchema = z
  .string()
  .url()
  .max(2_048)
  .refine((value) => new URL(value).protocol === "https:", "HTTPS URL required")

const sessionIdSchema = z.string().min(1).max(128)
const goalSchema = z.string().min(1).max(4_096)
const approvedSchema = z.boolean()
const noteSchema = z.string().max(2_048).optional()
const filenameSchema = z.string().min(1).max(256)

/**
 * 常用 channel schema 集合。
 * 新增 IPC channel 时应在此定义对应 schema，或使用 ipcArgsSchema（默认）。
 */
export const channelSchemas = {
  noArgs: z.tuple([]),
  id: z.tuple([idSchema]),
  idTitle: z.tuple([idSchema, shortTextSchema]),
  listOptions: z.tuple([
    z
      .object({
        limit: z.number().int().min(1).max(1_000).optional(),
        query: z.string().max(512).optional(),
        includeArchived: z.boolean().optional(),
      })
      .strict()
      .optional(),
  ]),
  /** skills:fs-system-prompt — 技能名数组（IPC 边界校验，与 manager 侧路径白名单双保险）。 */
  skillNames: z.tuple([z.array(idSchema).min(1).max(32)]),
  sessionCreate: z.tuple([
    z
      .object({
        title: shortTextSchema.optional(),
        directory: workspacePathSchema.optional(),
        providerId: idSchema.optional(),
        modelId: idSchema.optional(),
      })
      .strict(),
  ]),
  chatSend: z.tuple([
    z
      .object({
        sessionId: idSchema,
        text: z.string().min(1).max(1_000_000),
        providerId: idSchema,
        modelId: idSchema,
        skillNames: z.array(idSchema).max(32).optional(),
      })
      .strict(),
  ]),
  providerOverride: z.tuple([
    idSchema,
    z
      .object({
        enabled: z.boolean().optional(),
        name: shortTextSchema.optional(),
        options: z
          .object({
            baseURL: httpsUrlSchema.optional(),
            apiKey: z.string().max(16_384).optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  ]),
  // ---- Multi-agent 协作契约 ----
  multiAgentStart: z.tuple([
    z
      .object({
        sessionId: sessionIdSchema,
        goal: goalSchema,
      })
      .strict(),
  ]),
  multiAgentId: z.tuple([
    z
      .object({
        sessionId: sessionIdSchema,
      })
      .strict(),
  ]),
  multiAgentDecision: z.tuple([
    z
      .object({
        sessionId: sessionIdSchema,
        approved: approvedSchema,
        note: noteSchema,
      })
      .strict(),
  ]),
  multiAgentFilename: z.tuple([
    z
      .object({
        filename: filenameSchema,
      })
      .strict(),
  ]),
  marketplaceInstall: z.tuple([
    z
      .object({
        marketplace: idSchema,
        name: idSchema,
      })
      .strict(),
  ]),
  marketplaceUninstall: z.tuple([
    z
      .object({
        name: idSchema,
        marketplace: shortTextSchema.optional(),
      })
      .strict(),
  ]),
  marketplaceUpgrade: z.tuple([
    z
      .object({
        name: idSchema,
        marketplace: shortTextSchema.optional(),
        version: z.string().max(64).optional(),
      })
      .strict(),
  ]),
  marketplaceDescribe: z.tuple([idSchema, shortTextSchema.optional()]),
  // ---- Updater 契约 ----
  updaterCheck: z.tuple([
    z
      .object({
        feedUrl: httpsUrlSchema.optional(),
        download: z.boolean().optional(),
      })
      .strict()
      .optional(),
  ]),
  updaterSetConfig: z.tuple([
    z
      .object({
        channel: z.string().min(1).max(32).optional(),
        feedUrl: httpsUrlSchema.optional(),
        autoDownload: z.boolean().optional(),
        autoInstallOnAppQuit: z.boolean().optional(),
      })
      .strict(),
  ]),
} as const

// ─── Payload 检查 ────────────────────────────────────────

/**
 * 递归检查 IPC payload 的安全性。
 * 抛出 Error 如果 payload 违反任何限制。
 *
 * 检查项：
 * - 嵌套深度不超过 MAX_IPC_DEPTH
 * - 字符串长度不超过 MAX_IPC_STRING
 * - 不包含循环引用
 * - 数组长度不超过 MAX_IPC_ARRAY
 * - 对象必须是纯对象（Object.prototype 或 null）
 * - 对象键数不超过 MAX_IPC_KEYS
 * - 不包含危险键（__proto__/constructor/prototype）
 */
export function inspectValue(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): void {
  if (depth > MAX_IPC_DEPTH) {
    throw new Error("IPC payload exceeds maximum depth")
  }
  if (typeof value === "string" && value.length > MAX_IPC_STRING) {
    throw new Error("IPC string exceeds maximum length")
  }
  if (!value || typeof value !== "object") return

  if (seen.has(value)) {
    throw new Error("IPC payload must not contain cycles")
  }
  seen.add(value)

  if (Array.isArray(value)) {
    if (value.length > MAX_IPC_ARRAY) {
      throw new Error("IPC array exceeds maximum length")
    }
    for (const item of value) {
      inspectValue(item, depth + 1, seen)
    }
    return
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("IPC payload must contain plain objects only")
  }

  const keys = Object.keys(value)
  if (keys.length > MAX_IPC_KEYS) {
    throw new Error("IPC object has too many keys")
  }
  for (const key of keys) {
    if (BLOCKED_KEYS.has(key)) {
      throw new Error(`IPC key is not allowed: ${key}`)
    }
    inspectValue((value as Record<string, unknown>)[key], depth + 1, seen)
  }
}

// ─── URL 工具 ────────────────────────────────────────────

function normalizeUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

// ─── 安全上下文 ──────────────────────────────────────────

export interface IpcSecurityOptions {
  ipcMain: IpcMain
  getMainWindow: () => BrowserWindow | null
  /** 开发模式下的 dev server URL，如 http://localhost:5173 */
  devUrl?: string
  /** 打包后的 index.html 绝对路径 */
  distHtml: string
}

export interface IpcSecurity {
  /** 包装 ipcMain.handle，自动执行发送者验证 + payload 检查 + schema 解析 */
  handle: (
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>,
    schema?: z.ZodType,
  ) => void
  /** 独立的发送者验证函数，可在非 handle 场景使用 */
  assertTrustedSender: (event: IpcMainInvokeEvent) => void
}

/**
 * 创建 IPC 安全上下文。
 *
 * 使用方式：
 * ```ts
 * const security = createIpcSecurity({ ipcMain, getMainWindow, devUrl: "http://localhost:5173", distHtml: path.join(__dirname, "../dist/index.html") })
 * security.handle("my-channel", async (event, arg) => { ... }, channelSchemas.id)
 * ```
 */
export function createIpcSecurity(options: IpcSecurityOptions): IpcSecurity {
  const { ipcMain, getMainWindow, devUrl = "", distHtml } = options
  const devOrigin = normalizeUrl(devUrl)?.origin || null
  const expectedDist = path.resolve(distHtml)

  function assertTrustedSender(event: IpcMainInvokeEvent): void {
    const window = getMainWindow()
    const frame = event?.senderFrame
    if (!window || window.isDestroyed() || event?.sender?.id !== window.webContents.id) {
      throw new Error("IPC sender is not the main window")
    }
    if (!frame || frame !== event.sender.mainFrame) {
      throw new Error("IPC sender must be the main frame")
    }
    const url = normalizeUrl(frame.url)
    const devTrusted = devOrigin ? url?.origin === devOrigin : false
    let fileTrusted = false
    if (url?.protocol === "file:") {
      const filePath = decodeURIComponent(url.pathname).replace(/^\/(?:([A-Za-z]:))/, "$1")
      fileTrusted = path.resolve(filePath) === expectedDist
    }
    if (!devTrusted && !fileTrusted) {
      throw new Error("IPC sender origin is not trusted")
    }
  }

  function handle(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>,
    schema: z.ZodType = ipcArgsSchema,
  ): void {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...rawArgs: unknown[]) => {
      try {
        assertTrustedSender(event)
        inspectValue(rawArgs)
        const args = schema.parse(rawArgs) as unknown[]
        return await handler(event, ...args)
      } catch (error) {
        console.warn("ipc rejected", {
          channel,
          reason: String(error instanceof Error ? error.message : error),
        })
        throw error
      }
    })
  }

  return { handle, assertTrustedSender }
}

// ─── 推送通道注册表 ─────────────────────────────────

export interface PushChannelOptions {
  /** 限流配置（可选） */
  rateLimit?: { max: number; windowMs: number }
  /**
   * 时序校验的事件构造器（可选）。
   * 配置后 pushWithGuard 会先做 schema 校验，再按 sessionIdOf(payload) 取该会话的
   * 状态机实例，把 mapEvent(payload) 构造的事件喂给状态机做转移校验。
   * 转移未改变状态（非法转移）时抛错且不 send，并累计该通道违规次数。
   * mapEvent 未配置的通道跳过时序校验。
   */
  mapEvent?: (payload: unknown) => StreamEvent | null
  /** 从 payload 提取 sessionId（时序校验用）。与 mapEvent 配套配置。 */
  sessionIdOf?: (payload: unknown) => string
}

interface PushChannelEntry {
  schema: z.ZodType
  options?: PushChannelOptions
}

const pushChannelRegistry = new Map<string, PushChannelEntry>()

/**
 * 注册一个推送通道。
 * 通道名必须是非空字符串，schema 必须是 Zod schema。
 * 重复注册会抛出错误。
 */
export function registerPushChannel(
  channel: string,
  schema: z.ZodType,
  options?: PushChannelOptions,
): void {
  if (!channel || typeof channel !== "string") {
    throw new Error("Push channel name must be a non-empty string")
  }
  if (pushChannelRegistry.has(channel)) {
    throw new Error(`Push channel already registered: ${channel}`)
  }
  pushChannelRegistry.set(channel, { schema, options })
}

/**
 * 通过已注册的推送通道发送消息。
 * 校验 payload 是否符合 schema，如通过则调用 webContents.send。
 * 未注册的通道或非法 payload 会抛出错误。
 * 超过限流也会抛出错误。
 * 若通道配置了 mapEvent/sessionIdOf，还会先做事件时序校验：
 *   按会话取状态机实例，转移未改变状态（非法转移）时抛错且不 send，并累计违规次数。
 */
export function pushWithGuard(
  webContents: import("electron").WebContents,
  channel: string,
  ...args: unknown[]
): void {
  const entry = pushChannelRegistry.get(channel)
  if (!entry) {
    throw new Error(`Push channel not registered: ${channel}`)
  }

  // 限流检查
  if (entry.options?.rateLimit) {
    const { max, windowMs } = entry.options.rateLimit
    const key = `push:${channel}`
    let limiter = rateLimiters.get(key)
    if (!limiter) {
      limiter = createRateLimiter({ max, windowMs })
      rateLimiters.set(key, limiter)
    }
    if (!limiter.allow()) {
      throw new Error(`Push channel rate limit exceeded: ${channel}`)
    }
  }

  // schema 校验
  const parsed = entry.schema.parse(args[0])

  // 时序校验（仅当通道配置了 mapEvent/sessionIdOf）
  const { mapEvent, sessionIdOf } = entry.options ?? {}
  if (mapEvent && sessionIdOf) {
    const sessionId = sessionIdOf(parsed)
    const event = mapEvent(parsed)
    if (event !== null) {
      let machine = sessionStates.get(sessionId)
      if (!machine) {
        machine = createChatStreamState()
        sessionStates.set(sessionId, machine)
      }
      const before = machine.getState()
      machine.transition(event)
      const after = machine.getState()
      if (before === after) {
        // 转移未改变状态 → 非法转移
        pushViolations[channel] = (pushViolations[channel] ?? 0) + 1
        throw new Error(
          `Illegal stream transition on channel "${channel}" for session "${sessionId}"`,
        )
      }
    }
  }

  // 发送
  webContents.send(channel, parsed)
}

// 推送通道的限流器缓存（按通道名）
const rateLimiters = new Map<string, ReturnType<typeof createRateLimiter>>()

// 会话级状态机缓存（按 sessionId）。仅在通道配置了 mapEvent/sessionIdOf 时才会建实例。
const sessionStates = new Map<string, ChatStreamState>()

// 每通道时序违规计数（诊断用）
const pushViolations: Record<string, number> = {}

/**
 * 获取每通道的时序违规次数快照（测试/诊断用）。
 */
export function getPushViolationStats(): Readonly<Record<string, number>> {
  return { ...pushViolations }
}

/**
 * 清理单个会话的时序守卫状态（会话删除时调用，防止残留机器陈旧误判）。
 */
export function clearSessionGuardState(sessionId: string): void {
  sessionStates.delete(sessionId)
}

/**
 * 重置推送通道注册表（测试用）。
 * 一并清空限流器缓存、会话状态机与违规统计。
 */
export function resetPushRegistry(): void {
  pushChannelRegistry.clear()
  rateLimiters.clear()
  sessionStates.clear()
  for (const key of Object.keys(pushViolations)) {
    delete pushViolations[key]
  }
}

/**
 * 获取当前推送通道注册表快照（测试/诊断用）。
 */
export function getPushChannelRegistry(): ReadonlyMap<string, PushChannelEntry> {
  return pushChannelRegistry
}
