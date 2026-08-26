/**
 * Security Module Index — 安全模块统一导出
 *
 * 从 zcode-client 迁移的安全架构，TypeScript 重写。
 * 包含三大核心模块：
 * 1. ipc-guard — IPC 传输层安全（发送者验证、payload 检查、zod schema、路径信任根）
 * 2. tool-capability — 工具能力授权（HMAC-SHA256 一次性令牌）
 * 3. rpc-hub — JSON-RPC 2.0 应用层路由（方法分发、中间件、批量请求）
 *
 * 使用方式：
 * ```ts
 * import { createIpcSecurity, createToolCapabilityAuthority, RpcHub, channelSchemas } from "./security"
 * ```
 */

export {
  createIpcSecurity,
  assertAllowedShellPath,
  inspectValue,
  channelSchemas,
  ipcArgsSchema,
  rpcMessageSchema,
  rpcArgsSchema,
  targetPathSchema,
  MAX_IPC_DEPTH,
  MAX_IPC_KEYS,
  MAX_IPC_STRING,
  MAX_IPC_ARRAY,
  BLOCKED_KEYS,
  type IpcSecurity,
  type IpcSecurityOptions,
} from "./ipc-guard"

export {
  createToolCapabilityAuthority,
  hashToolRequest,
  summarizeToolInput,
  DEFAULT_TTL_MS,
  SENSITIVE_KEYS,
  type ToolRequest,
  type ToolInputSummary,
  type ToolCapabilityAuthority,
  type AuthorityOptions,
  type CapabilityBody,
} from "./tool-capability"

export {
  RpcHub,
  RpcErrorCode,
  MAX_METHOD_LENGTH,
  MIN_BATCH_SIZE,
  MAX_BATCH_SIZE,
  type RpcRequest,
  type RpcResponse,
  type RpcSuccessResponse,
  type RpcErrorResponse,
  type RpcContext,
  type RpcMiddleware,
  type RpcHandler,
  type RpcId,
  type RpcMessage,
} from "./rpc-hub"
