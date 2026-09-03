/**
 * Tool Capability Authority — 工具能力授权机构
 *
 * 从 zcode-client 的 tool-capability.mjs 迁移，TypeScript 重写。
 * 核心能力：
 * 1. hashToolRequest — SHA256 哈希工具请求（tool + workspace + input）
 * 2. summarizeToolInput — 工具输入摘要（过滤敏感键）
 * 3. createToolCapabilityAuthority — 创建授权机构，签发/消费一次性能力令牌
 *
 * 设计目的：
 * Agent 工具调用需要用户授权。传统方式是每次调用都弹对话框，影响体验。
 * 能力令牌系统允许用户在审批对话框中签发一个短期（默认60秒）令牌，
 * 令牌绑定到具体的工具请求哈希，只能使用一次，防止重放和越权。
 */
import crypto from "node:crypto"
import path from "node:path"

// ─── 常量 ────────────────────────────────────────────────

export const DEFAULT_TTL_MS = 60_000
export const SENSITIVE_KEYS =
  /(?:api[-_]?key|authorization|cookie|credential|password|secret|token)/i

// ─── 类型 ────────────────────────────────────────────────

export interface ToolRequest {
  tool: string
  workspace: string
  input: Record<string, unknown>
}

export interface ToolInputSummary {
  keys: string[]
  redactedKeys: number
}

export interface CapabilityBody {
  id: string
  digest: string
  issuedAt: number
  expiresAt: number
}

export interface ToolCapabilityAuthority {
  /** 签发一个能力令牌，返回 JWT 风格的 base64url.signature 字符串 */
  issue: (request: ToolRequest) => string
  /** 验证并消费一个能力令牌（一次性使用），返回是否有效 */
  consume: (token: string, request: ToolRequest) => boolean
}

export interface AuthorityOptions {
  /** 令牌有效期（毫秒），默认 60 秒 */
  ttlMs?: number
  /** 当前时间函数，可注入用于测试 */
  now?: () => number
  /** UUID 生成函数，可注入用于测试 */
  randomUUID?: () => string
}

// ─── 工具函数 ────────────────────────────────────────────

/**
 * 规范化对象：递归排序键名，确保相同内容的对象哈希一致。
 * 数组保持顺序，对象按 key 排序。
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (!value || typeof value !== "object") {
    return value
  }
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
  )
}

// ─── 哈希 ────────────────────────────────────────────────

/**
 * 计算工具请求的 SHA256 哈希。
 * 哈希内容：tool（字符串化）+ workspace（绝对路径解析）+ input（规范化后 JSON）。
 *
 * 用于能力令牌绑定：令牌只对特定的工具请求有效。
 */
export function hashToolRequest({ tool, workspace, input }: ToolRequest): string {
  const normalized = JSON.stringify({
    tool: String(tool || ""),
    workspace: path.resolve(String(workspace || ".")),
    input: canonicalize(input || {}),
  })
  return crypto.createHash("sha256").update(normalized).digest("hex")
}

// ─── 输入摘要 ────────────────────────────────────────────

/**
 * 生成工具输入的非敏感摘要。
 * - 过滤掉敏感键（apiKey/authorization/token/secret/password 等）
 * - 最多返回 20 个键名
 * - 返回被过滤掉的敏感键数量
 *
 * 用于日志和审计：记录工具调用了什么参数，但不泄露敏感值。
 */
export function summarizeToolInput(input: Record<string, unknown>): ToolInputSummary {
  const allKeys = Object.keys(input || {})
  const keys = allKeys
    .filter((key) => !SENSITIVE_KEYS.test(key))
    .sort()
    .slice(0, 20)
  const redactedKeys = allKeys.filter((key) => SENSITIVE_KEYS.test(key)).length
  return { keys, redactedKeys }
}

// ─── 授权机构 ────────────────────────────────────────────

/**
 * 创建工具能力授权机构。
 *
 * 安全设计：
 * - 令牌使用 HMAC-SHA256 签名，密钥在内存中随机生成（32字节），不持久化
 * - 令牌是一次性的：consume 后从 issued Map 中删除，无法重放
 * - 令牌绑定到具体请求哈希：即使令牌被窃取，也只能用于相同的工具请求
 * - 令牌有 TTL：过期后自动失效
 * - 签名验证使用 timingSafeEqual，防止时序攻击
 *
 * 使用方式：
 * ```ts
 * const authority = createToolCapabilityAuthority()
 * const token = authority.issue({ tool: "bash", workspace: "/proj", input: { cmd: "ls" } })
 * // ... 用户审批后，Agent 持有 token ...
 * const ok = authority.consume(token, { tool: "bash", workspace: "/proj", input: { cmd: "ls" } })
 * if (ok) executeTool(...)
 * ```
 */
export function createToolCapabilityAuthority(
  options: AuthorityOptions = {},
): ToolCapabilityAuthority {
  const { ttlMs = DEFAULT_TTL_MS, now = () => Date.now(), randomUUID = crypto.randomUUID } = options

  const secret = crypto.randomBytes(32)
  const issued = new Map<string, CapabilityBody>()

  function sign(payload: string): string {
    return crypto.createHmac("sha256", secret).update(payload).digest("base64url")
  }

  function issue(request: ToolRequest): string {
    const body: CapabilityBody = {
      id: randomUUID(),
      digest: hashToolRequest(request),
      issuedAt: now(),
      expiresAt: now() + ttlMs,
    }
    const encoded = Buffer.from(JSON.stringify(body)).toString("base64url")
    issued.set(body.id, body)
    return `${encoded}.${sign(encoded)}`
  }

  function consume(token: string, request: ToolRequest): boolean {
    if (typeof token !== "string") return false
    const [encoded, signature, extra] = token.split(".")
    if (!encoded || !signature || extra) return false

    const expected = sign(encoded)
    const actualBuffer = Buffer.from(signature)
    const expectedBuffer = Buffer.from(expected)
    if (actualBuffer.length !== expectedBuffer.length) return false
    if (!crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return false

    let body: CapabilityBody
    try {
      body = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))
    } catch {
      return false
    }

    const record = issued.get(body.id)
    if (!record) return false
    issued.delete(body.id) // 一次性使用

    if (record.expiresAt < now()) return false

    const requestDigest = hashToolRequest(request)
    return record.digest === requestDigest && body.digest === record.digest
  }

  return { issue, consume }
}
