/**
 * SDK Adapter — Dave Engine SDK 适配层
 *
 * 从 engine-integration-plan Phase 2 迁移。
 * 作为 dave-desktop 与 @dave/sdk 之间的适配层，隔离 SDK 接口变更。
 *
 * 设计原则：
 * 1. 适配层是 dave-desktop 与 SDK 之间的唯一入口
 * 2. 所有 SDK 调用都经过适配层，便于后续替换 SDK 版本
 * 3. 适配层提供 dave-desktop 风格的 API（Promise-based，IPC 友好）
 * 4. SDK 不可用时降级到本地实现（fallback）
 *
 * 当前状态：骨架实现，SDK 接口待 @dave/sdk 稳定后填充
 */

import { log } from "electron-log"
import { getConfig } from "../../../shared/config" // 从 dave shared 包导入（待发布后）

// ─── 类型 ────────────────────────────────────────────────

export interface SdkStatus {
  available: boolean
  version: string | null
  modulePath: string | null
  error: string | null
}

export interface AgentRunOptions {
  sessionId: string
  prompt: string
  providerId?: string
  modelId?: string
  workspace?: string
  skillNames?: string[]
  onEvent?: (event: AgentEvent) => void
  onToken?: (token: string) => void
  onToolCall?: (toolCall: ToolCall) => void
  onToolResult?: (toolResult: ToolResult) => void
}

export interface AgentEvent {
  type: "start" | "thinking" | "tool_call" | "tool_result" | "token" | "complete" | "error" | "abort"
  timestamp: number
  data?: unknown
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolResult {
  callId: string
  result: unknown
  error?: string
}

export interface AgentRunResult {
  sessionId: string
  response: string
  toolCalls: ToolCall[]
  tokenUsage: {
    prompt: number
    completion: number
    total: number
  }
  durationMs: number
}

export interface SessionInfo {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  providerId?: string
  modelId?: string
}

export interface ProviderInfo {
  id: string
  name: string
  models: string[]
  apiKeyPresent: boolean
  baseUrl?: string
}

// ─── SDK 加载 ─────────────────────────────────────────────

let sdkInstance: unknown | null = null
let sdkLoadError: string | null = null
let sdkLoadAttempted = false

async function loadSdk(): Promise<unknown | null> {
  if (sdkLoadAttempted) return sdkInstance
  sdkLoadAttempted = true

  try {
    // 动态导入 @dave/sdk
    // 待 SDK 发布到 npm 或 workspace 链接后启用
    // const sdk = await import("@dave/sdk")
    // sdkInstance = sdk
    // log.info("[sdk-adapter] @dave/sdk loaded successfully")
    log.info("[sdk-adapter] @dave/sdk not yet integrated, using local fallback")
    sdkLoadError = "@dave/sdk not yet integrated"
    return null
  } catch (err) {
    sdkLoadError = String(err instanceof Error ? err.message : err)
    log.warn(`[sdk-adapter] Failed to load @dave/sdk: ${sdkLoadError}`)
    return null
  }
}

// ─── SDK 适配层主类 ───────────────────────────────────────

export class SdkAdapter {
  private sdk: unknown | null = null
  private initialized = false

  /**
   * 初始化适配层，尝试加载 SDK。
   * SDK 不可用时降级到本地实现。
   */
  async initialize(): Promise<SdkStatus> {
    if (this.initialized) {
      return this.getStatus()
    }
    this.initialized = true

    this.sdk = await loadSdk()

    if (this.sdk) {
      // SDK 可用，初始化 SDK 配置
      log.info("[sdk-adapter] Initialized with @dave/sdk")
    } else {
      // SDK 不可用，使用本地 fallback
      log.info("[sdk-adapter] Initialized with local fallback")
    }

    return this.getStatus()
  }

  /** 获取 SDK 状态 */
  getStatus(): SdkStatus {
    return {
      available: this.sdk !== null,
      version: null, // 待 SDK 提供版本信息
      modulePath: null,
      error: sdkLoadError,
    }
  }

  /** 检查 SDK 是否可用 */
  isAvailable(): boolean {
    return this.sdk !== null
  }

  // ─── Agent 运行 ──────────────────────────────────────

  /**
   * 运行 Agent 对话。
   * SDK 可用时委托给 SDK，否则使用本地 fallback。
   */
  async runAgent(options: AgentRunOptions): Promise<AgentRunResult> {
    const startTime = Date.now()

    if (this.sdk) {
      // TODO: 委托给 @dave/sdk 的 AgentLoop.run()
      // return this.sdk.agent.run(options)
      log.info("[sdk-adapter] runAgent delegated to SDK (stub)")
    }

    // Local fallback — 委托给本地 chat-loop
    // 实际实现中调用 handleChatStream
    log.info(`[sdk-adapter] runAgent local fallback: session=${options.sessionId}`)

    return {
      sessionId: options.sessionId,
      response: "", // 由本地实现填充
      toolCalls: [],
      tokenUsage: { prompt: 0, completion: 0, total: 0 },
      durationMs: Date.now() - startTime,
    }
  }

  /**
   * 中止正在运行的 Agent。
   */
  async abortAgent(sessionId: string): Promise<boolean> {
    if (this.sdk) {
      // TODO: 委托给 SDK
      // return this.sdk.agent.abort(sessionId)
    }
    // Local fallback
    log.info(`[sdk-adapter] abortAgent local fallback: session=${sessionId}`)
    return true
  }

  // ─── 会话管理 ────────────────────────────────────────

  /**
   * 列出所有会话。
   */
  async listSessions(): Promise<SessionInfo[]> {
    if (this.sdk) {
      // TODO: 委托给 SDK 的 SessionManager
      // return this.sdk.sessions.list()
    }
    // Local fallback — 委托给本地 session 模块
    log.info("[sdk-adapter] listSessions local fallback")
    return []
  }

  /**
   * 创建新会话。
   */
  async createSession(options?: { title?: string; providerId?: string; modelId?: string }): Promise<SessionInfo> {
    if (this.sdk) {
      // TODO: 委托给 SDK
      // return this.sdk.sessions.create(options)
    }
    // Local fallback
    const now = Date.now()
    return {
      id: `sess_${now}`,
      title: options?.title || "新会话",
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      providerId: options?.providerId,
      modelId: options?.modelId,
    }
  }

  // ─── Provider 管理 ───────────────────────────────────

  /**
   * 列出所有已配置的 Provider。
   */
  async listProviders(): Promise<ProviderInfo[]> {
    if (this.sdk) {
      // TODO: 委托给 SDK 的 ProviderManager
      // return this.sdk.providers.list()
    }
    // Local fallback — 从配置读取
    const config = getConfig()
    const providers: ProviderInfo[] = []
    for (const [id, provider] of Object.entries(config.provider || {})) {
      providers.push({
        id,
        name: provider.name || id,
        models: Object.keys(provider.models || {}),
        apiKeyPresent: Boolean(provider.apiKey || provider.apiKeyEnv),
        baseUrl: provider.baseURL,
      })
    }
    return providers
  }

  // ─── 工具注册 ────────────────────────────────────────

  /**
   * 注册自定义工具。
   */
  registerTool(name: string, handler: (args: Record<string, unknown>) => Promise<unknown>): void {
    if (this.sdk) {
      // TODO: 委托给 SDK 的 ToolRegistry
      // this.sdk.tools.register(name, handler)
      return
    }
    // Local fallback — 注册到本地工具注册表
    log.info(`[sdk-adapter] registerTool local fallback: ${name}`)
  }

  // ─── 技能加载 ────────────────────────────────────────

  /**
   * 加载技能。
   */
  async loadSkills(skillNames: string[]): Promise<Array<{ name: string; loaded: boolean; error?: string }>> {
    if (this.sdk) {
      // TODO: 委托给 SDK 的 SkillLoader
      // return this.sdk.skills.load(skillNames)
    }
    // Local fallback — 委托给本地 skills-manager
    log.info(`[sdk-adapter] loadSkills local fallback: ${skillNames.join(", ")}`)
    return skillNames.map((name) => ({ name, loaded: false, error: "not implemented" }))
  }

  // ─── 配置同步 ────────────────────────────────────────

  /**
   * 将 dave-desktop 的配置同步到 SDK。
   */
  async syncConfig(): Promise<void> {
    if (!this.sdk) return
    // TODO: 将 DaveConfig 同步到 SDK
    // const config = getConfig()
    // this.sdk.config.update(config)
    log.info("[sdk-adapter] syncConfig (stub)")
  }

  // ─── 健康检查 ────────────────────────────────────────

  /**
   * 健康检查，返回 SDK 各子系统状态。
   */
  async healthCheck(): Promise<Record<string, unknown>> {
    return {
      sdk: this.getStatus(),
      config: { loaded: true, model: getConfig().model || null },
      agent: { running: 0 },
      sessions: { count: 0 },
      providers: { count: (await this.listProviders()).length },
    }
  }
}

// ─── 单例 ─────────────────────────────────────────────────

let defaultAdapter: SdkAdapter | null = null

/** 获取默认的 SDK 适配层单例 */
export function getSdkAdapter(): SdkAdapter {
  if (!defaultAdapter) {
    defaultAdapter = new SdkAdapter()
  }
  return defaultAdapter
}
