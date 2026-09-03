/**
 * Security Module Index — 安全模块统一导出
 *
 * 从 zcode-client 迁移的安全架构，TypeScript 重写。
 * 包含核心模块：
 * 1. ipc-guard — IPC 传输层安全（发送者验证、payload 检查、zod schema）
 * 2. tool-capability — 工具能力授权（HMAC-SHA256 一次性令牌）
 * 3. browser-policy — 浏览器策略（URL/路径/协议白名单）
 *
 * 使用方式：
 * ```ts
 * import { createIpcSecurity, createToolCapabilityAuthority, channelSchemas } from "./security"
 * ```
 */

export {
  createIpcSecurity,
  inspectValue,
  channelSchemas,
  ipcArgsSchema,
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
  BrowserPolicy,
  type BrowserPolicyOptions,
  type UrlCheckResult,
  type PathCheckResult,
  type ProtocolPolicy,
} from "./browser-policy"
