/**
 * RPC Hub — 轻量级 JSON-RPC 2.0 协议实现
 *
 * 从 zcode-client 的 rpc.mjs 迁移，TypeScript 重写。
 * 核心能力：
 * 1. RpcHub 类 — 方法注册、中间件、批量请求、标准错误码
 * 2. 方法名长度限制（160字符），批量大小限制（1-20条）
 *
 * 设计目的：
 * 为 dave-desktop 的主进程提供统一的 RPC 层，替代零散的 ipcMain.handle。
 * Renderer 通过单个 IPC channel（如 "rpc:request"）发送 JSON-RPC 消息，
 * 主进程 RpcHub 路由到具体方法处理器。
 *
 * 与 ipc-guard 的关系：
 * - ipc-guard 负责传输层安全（发送者验证、payload 检查）
 * - RpcHub 负责应用层路由（方法分发、中间件、错误处理）
 * - 两者配合：ipc-guard.handle("rpc:request", rpcHub.handleMessage, rpcArgsSchema)
 */

// ─── JSON-RPC 2.0 标准错误码 ────────────────────────────

export const RpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const

// ─── 类型 ────────────────────────────────────────────────

export type RpcId = string | number | null

export interface RpcRequest {
  jsonrpc?: "2.0"
  id?: RpcId
  method: string
  params?: unknown
}

export interface RpcSuccessResponse {
  jsonrpc: "2.0"
  id: RpcId
  result: unknown
}

export interface RpcErrorResponse {
  jsonrpc: "2.0"
  id: RpcId
  error: {
    code: number
    message: string
    data?: unknown
  }
}

export type RpcResponse = RpcSuccessResponse | RpcErrorResponse
export type RpcMessage = RpcRequest | RpcRequest[]

export interface RpcContext {
  [key: string]: unknown
}

export type RpcMiddleware = (payload: {
  method: string
  params: unknown
  ctx: RpcContext
}) => Promise<{ method: string; params: unknown; ctx: RpcContext }> | { method: string; params: unknown; ctx: RpcContext }

export type RpcHandler = (params: unknown, ctx: RpcContext) => Promise<unknown> | unknown

// ─── 限制常量 ────────────────────────────────────────────

export const MAX_METHOD_LENGTH = 160
export const MIN_BATCH_SIZE = 1
export const MAX_BATCH_SIZE = 20

// ─── RpcHub 类 ───────────────────────────────────────────

/**
 * 轻量级 JSON-RPC 2.0 Hub。
 *
 * 特性：
 * - 方法注册与分发
 * - 中间件链（可修改 params/ctx）
 * - 批量请求支持（1-20条）
 * - 标准错误码
 * - 方法名长度限制
 *
 * 使用方式：
 * ```ts
 * const hub = new RpcHub()
 * hub.method("system.ping", async () => ({ ok: true, ts: Date.now() }))
 * hub.method("sessions.list", async (params) => listSessions(params))
 *
 * // 中间件：日志
 * hub.use(async ({ method, params, ctx }) => {
 *   console.log("rpc call", method)
 *   return { method, params, ctx }
 * })
 *
 * // 处理消息
 * const response = await hub.handleMessage({ jsonrpc: "2.0", id: 1, method: "system.ping" })
 * ```
 */
export class RpcHub {
  private methods = new Map<string, RpcHandler>()
  private middlewares: RpcMiddleware[] = []

  /** 注册一个中间件，按注册顺序执行 */
  use(fn: RpcMiddleware): void {
    this.middlewares.push(fn)
  }

  /** 注册一个方法处理器 */
  method(name: string, handler: RpcHandler): void {
    this.methods.set(name, handler)
  }

  /** 列出所有已注册的方法名（排序） */
  listMethods(): string[] {
    return [...this.methods.keys()].sort()
  }

  /**
   * 调用一个方法（内部使用，不经 handleMessage 的校验）。
   * 会执行中间件链。
   */
  async call(method: string, params: unknown = {}, ctx: RpcContext = {}): Promise<unknown> {
    const handler = this.methods.get(method)
    if (!handler) {
      const err = new Error(`Method not found: ${method}`)
      ;(err as Error & { code?: number }).code = RpcErrorCode.MethodNotFound
      throw err
    }
    let payload = { method, params, ctx }
    for (const mw of this.middlewares) {
      payload = (await mw(payload)) || payload
    }
    return handler(payload.params, payload.ctx)
  }

  /**
   * 处理一条 JSON-RPC 消息（单条或批量）。
   * 返回标准 JSON-RPC 响应（单条或批量）。
   *
   * 校验：
   * - 消息必须是对象
   * - 批量请求大小在 1-20 之间
   * - method 必须是非空字符串且长度 <= 160
   */
  async handleMessage(message: RpcMessage, ctx: RpcContext = {}): Promise<RpcResponse | RpcResponse[] | null> {
    if (!message || typeof message !== "object") {
      return errorResponse(null, RpcErrorCode.InvalidRequest, "Invalid Request")
    }

    if (Array.isArray(message)) {
      if (message.length === 0 || message.length > MAX_BATCH_SIZE) {
        return errorResponse(null, RpcErrorCode.InvalidRequest, "Invalid Request: batch size must be between 1 and 20")
      }
      const out: RpcResponse[] = []
      for (const item of message) {
        const result = await this.handleMessage(item, ctx)
        if (result) out.push(result as RpcResponse)
      }
      return out
    }

    const { id = null, method, params } = message as RpcRequest
    if (!method || typeof method !== "string" || method.length > MAX_METHOD_LENGTH) {
      return errorResponse(id, RpcErrorCode.InvalidRequest, "Invalid Request: method required")
    }

    try {
      const result = await this.call(method, params ?? {}, ctx)
      return { jsonrpc: "2.0", id, result }
    } catch (err) {
      const error = err as Error & { code?: number; stack?: string }
      return errorResponse(id, error.code || RpcErrorCode.InternalError, String(error.message || err), {
        stack: error.stack,
      })
    }
  }
}

// ─── 工具函数 ────────────────────────────────────────────

function errorResponse(id: RpcId, code: number, message: string, data?: unknown): RpcErrorResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data !== undefined ? { data } : {}),
    },
  }
}
