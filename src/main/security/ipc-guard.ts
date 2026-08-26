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
import fs from "node:fs"
import path from "node:path"
import { z } from "zod"

// ─── 常量 ────────────────────────────────────────────────

export const MAX_IPC_DEPTH = 12
export const MAX_IPC_KEYS = 500
export const MAX_IPC_STRING = 1_000_000
export const MAX_IPC_ARRAY = 10_000
export const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"])

// ─── Zod Schemas ─────────────────────────────────────────

export const ipcArgsSchema = z.array(z.unknown()).max(20)

export const rpcMessageSchema = z.union([
  z
    .object({
      jsonrpc: z.literal("2.0").optional(),
      id: z.union([z.string().max(128), z.number().finite(), z.null()]).optional(),
      method: z.string().min(1).max(160),
      params: z.unknown().optional(),
    })
    .passthrough(),
  z.array(z.unknown()).min(1).max(20),
])

export const rpcArgsSchema = z.tuple([rpcMessageSchema])
export const targetPathSchema = z.string().min(1).max(32_768)

const idSchema = z.string().min(1).max(256)
const shortTextSchema = z.string().max(512)
const workspacePathSchema = z.string().min(1).max(32_768)
const stringListSchema = z.array(idSchema).max(1_000)
const plainRecordSchema = z.record(z.string().max(128), z.unknown())
const httpsUrlSchema = z
  .string()
  .url()
  .max(2_048)
  .refine((value) => new URL(value).protocol === "https:", "HTTPS URL required")

/**
 * 常用 channel schema 集合。
 * 新增 IPC channel 时应在此定义对应 schema，或使用 ipcArgsSchema（默认）。
 */
export const channelSchemas = {
  noArgs: z.tuple([]),
  targetPath: z.tuple([targetPathSchema]),
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
  protocolRequest: rpcArgsSchema,
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

// ─── 路径信任根验证 ──────────────────────────────────────

/**
 * 验证目标路径在受信任根目录内。
 * 返回解析后的绝对路径。
 *
 * 检查项：
 * - 必须是绝对路径
 * - 不得包含 null 字节
 * - Windows 下不得是网络路径（\\）或设备路径（\\.\）
 * - 解析后的路径必须在某个受信任根目录内
 *
 * @throws 如果路径不在受信任根内
 */
export function assertAllowedShellPath(targetPath: string, roots: string[]): string {
  const parsed = targetPathSchema.parse(targetPath)
  if (!path.isAbsolute(parsed) || parsed.includes("\0")) {
    throw new Error("absolute local path required")
  }
  if (process.platform === "win32" && (/^\\\\/.test(parsed) || /^\\\\[.?]\\/.test(parsed))) {
    throw new Error("network and device paths are not allowed")
  }
  const resolved = fs.existsSync(parsed) ? fs.realpathSync.native(parsed) : path.resolve(parsed)
  const allowed = roots.some((root) => {
    const resolvedRoot = fs.existsSync(root) ? fs.realpathSync.native(root) : path.resolve(root)
    const relative = path.relative(resolvedRoot, resolved)
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
  })
  if (!allowed) {
    throw new Error("path is outside trusted roots")
  }
  return resolved
}
