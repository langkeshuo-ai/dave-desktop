/**
 * Browser Policy — 浏览器安全策略
 *
 * 从 zcode-client 的 browser-security 设计迁移，TypeScript 实现。
 * 管理外链打开、嵌入式浏览器导航、本地路径访问的安全策略。
 *
 * 核心策略：
 * 1. 外链协议白名单 — 仅允许 https:（开发模式允许 http: localhost）
 * 2. 本地路径受信任根 — 仅允许在受信任目录内打开文件
 * 3. BrowserHub 导航策略 — 嵌入式浏览器的 URL 导航限制
 * 4. 弹窗策略 — window.open 的目标 URL 校验
 */
import { app } from "electron"
import path from "node:path"
import fs from "node:fs"
import { isPathWithin, getTrustedRoots } from "../utils/paths"

// ─── 类型 ────────────────────────────────────────────────

export type ProtocolPolicy = "allow" | "deny" | "ask"

export interface BrowserPolicyOptions {
  /** 允许的协议列表，默认 ["https:"] */
  allowedProtocols?: string[]
  /** 开发模式下允许的协议（额外），默认 ["http:"] */
  devAllowedProtocols?: string[]
  /** 是否为开发模式 */
  isDev?: boolean
  /** 受信任的本地根目录 */
  trustedRoots?: string[]
  /** 允许的 localhost 端口（开发模式） */
  devPorts?: number[]
}

export interface UrlCheckResult {
  allowed: boolean
  reason: string
  protocol: string
  hostname: string
  port: number | null
}

export interface PathCheckResult {
  allowed: boolean
  reason: string
  resolvedPath: string | null
}

// ─── 默认配置 ────────────────────────────────────────────

const DEFAULT_ALLOWED_PROTOCOLS = ["https:"]
const DEFAULT_DEV_ALLOWED_PROTOCOLS = ["http:"]
const DEFAULT_DEV_PORTS = [5173, 3000, 8080, 4173]

// ─── 策略类 ──────────────────────────────────────────────

export class BrowserPolicy {
  private allowedProtocols: Set<string>
  private isDev: boolean
  private trustedRoots: string[]
  private devPorts: Set<number>

  constructor(options: BrowserPolicyOptions = {}) {
    this.isDev = options.isDev ?? !app.isPackaged
    this.allowedProtocols = new Set([
      ...(options.allowedProtocols || DEFAULT_ALLOWED_PROTOCOLS),
      ...(this.isDev ? options.devAllowedProtocols || DEFAULT_DEV_ALLOWED_PROTOCOLS : []),
    ])
    this.trustedRoots = options.trustedRoots || getTrustedRoots()
    this.devPorts = new Set(options.devPorts || DEFAULT_DEV_PORTS)
  }

  /**
   * 检查 URL 是否允许打开（外链 / shell.openExternal）。
   * 规则：
   * - 协议必须在白名单内
   * - 开发模式下 http: 仅限 localhost + 允许的端口
   * - 禁止 file: 协议（防止本地文件泄露）
   * - 禁止 javascript: / data: 等危险协议
   */
  checkExternalUrl(url: string): UrlCheckResult {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { allowed: false, reason: "Invalid URL", protocol: "", hostname: "", port: null }
    }

    const protocol = parsed.protocol.toLowerCase()
    const hostname = parsed.hostname.toLowerCase()
    const port = parsed.port ? parseInt(parsed.port, 10) : null

    // 危险协议直接拒绝
    if (["javascript:", "data:", "vbscript:", "file:"].includes(protocol)) {
      return { allowed: false, reason: `Protocol ${protocol} is blocked`, protocol, hostname, port }
    }

    // 协议白名单
    if (!this.allowedProtocols.has(protocol)) {
      return {
        allowed: false,
        reason: `Protocol ${protocol} is not in allowlist`,
        protocol,
        hostname,
        port,
      }
    }

    // 开发模式 http: 仅限 localhost
    if (protocol === "http:" && this.isDev) {
      if (hostname !== "localhost" && hostname !== "127.0.0.1") {
        return {
          allowed: false,
          reason: "HTTP only allowed for localhost in dev mode",
          protocol,
          hostname,
          port,
        }
      }
      if (port && !this.devPorts.has(port)) {
        return {
          allowed: false,
          reason: `HTTP port ${port} not in dev allowlist`,
          protocol,
          hostname,
          port,
        }
      }
    }

    // 生产模式 http: 一律拒绝（除非在白名单内，但默认白名单只有 https）
    if (protocol === "http:" && !this.isDev) {
      return {
        allowed: false,
        reason: "HTTP is not allowed in production",
        protocol,
        hostname,
        port,
      }
    }

    return { allowed: true, reason: "OK", protocol, hostname, port }
  }

  /**
   * 检查本地文件路径是否允许访问。
   * 规则：
   * - 必须是绝对路径
   * - 不得包含 null 字节
   * - 必须在受信任根目录内
   * - Windows 下禁止网络路径（\\）和设备路径（\\.\）
   */
  checkLocalPath(targetPath: string): PathCheckResult {
    if (!targetPath || typeof targetPath !== "string") {
      return { allowed: false, reason: "Empty or invalid path", resolvedPath: null }
    }
    if (targetPath.includes("\0")) {
      return { allowed: false, reason: "Path contains null byte", resolvedPath: null }
    }
    if (!path.isAbsolute(targetPath)) {
      return { allowed: false, reason: "Path must be absolute", resolvedPath: null }
    }

    // Windows 网络/设备路径
    if (
      process.platform === "win32" &&
      (/^\\\\/.test(targetPath) || /^\\\\[.?]\\/.test(targetPath))
    ) {
      return {
        allowed: false,
        reason: "Network and device paths are not allowed",
        resolvedPath: null,
      }
    }

    let resolved: string
    try {
      resolved = fs.existsSync(targetPath)
        ? fs.realpathSync.native(targetPath)
        : path.resolve(targetPath)
    } catch {
      return { allowed: false, reason: "Path resolution failed", resolvedPath: null }
    }

    for (const root of this.trustedRoots) {
      if (isPathWithin(resolved, root)) {
        return { allowed: true, reason: "OK", resolvedPath: resolved }
      }
    }

    return { allowed: false, reason: "Path is outside trusted roots", resolvedPath: null }
  }

  /**
   * 检查嵌入式 BrowserView 的导航 URL。
   * 比外部链接更严格：不允许任何导航到外部域（除非在白名单内）。
   */
  checkNavigation(url: string, allowedHosts: string[] = []): UrlCheckResult {
    const result = this.checkExternalUrl(url)
    if (!result.allowed) return result

    // 如果有域名白名单，额外检查
    if (allowedHosts.length > 0) {
      const allowed = allowedHosts.some(
        (host) =>
          result.hostname === host.toLowerCase() ||
          result.hostname.endsWith(`.${host.toLowerCase()}`),
      )
      if (!allowed) {
        return {
          ...result,
          allowed: false,
          reason: `Host ${result.hostname} not in navigation allowlist`,
        }
      }
    }

    return result
  }

  /**
   * 检查 window.open 的目标 URL。
   * 策略：与外部链接相同，但额外阻止 _blank 打开 file:。
   */
  checkPopup(url: string): UrlCheckResult {
    const result = this.checkExternalUrl(url)
    if (!result.allowed) return result
    if (result.protocol === "file:") {
      return { ...result, allowed: false, reason: "Popups cannot open file: URLs" }
    }
    return result
  }

  /** 获取当前策略的可读状态（用于诊断面板） */
  getStatus(): Record<string, unknown> {
    return {
      isDev: this.isDev,
      allowedProtocols: [...this.allowedProtocols],
      devPorts: [...this.devPorts],
      trustedRootsCount: this.trustedRoots.length,
      trustedRoots: this.trustedRoots,
    }
  }
}

// ─── 单例 ─────────────────────────────────────────────────

let defaultPolicy: BrowserPolicy | null = null

/** 获取默认的 BrowserPolicy 单例 */
export function getBrowserPolicy(): BrowserPolicy {
  if (!defaultPolicy) {
    defaultPolicy = new BrowserPolicy()
  }
  return defaultPolicy
}
