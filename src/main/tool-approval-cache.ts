/**
 * Tool Approval Cache — 工具审批缓存（两级策略）
 *
 * 基于 security/tool-capability 的一次性能力令牌，实现"60 秒内免二次审批"。
 *
 * 两级策略：
 * 1. 精确输入哈希（tryAutoApprove / grantReusableApproval）
 *    - 令牌绑定到 tool + workspace + input 完整哈希
 *    - 仅完全相同的调用自动通过
 *    - 适用于写/执行工具（mutates: true）、MCP 工具、技能工具
 *
 * 2. 工具名级别（tryAutoApproveByTool / grantReusableApprovalByTool）
 *    - 令牌绑定到 tool + workspace（input 固定为 {}）
 *    - 60s 内同一工具的任意参数调用自动通过
 *    - 适用于只读工具（mutates: false），信息泄露风险可控
 *
 * 安全边界：
 * - 令牌一次性使用，60 秒 TTL，纯内存存储
 * - 写/执行工具永远使用精确输入哈希，防止批准一次后被利用修改任意文件
 * - 只读工具使用工具名级别，减少 LLM 连续读取不同文件时的重复弹窗
 */

import {
  createToolCapabilityAuthority,
  hashToolRequest,
  type ToolRequest,
} from "./security/tool-capability"

const authority = createToolCapabilityAuthority()
// digest → token，用于下次相同调用时查找
const tokenByDigest = new Map<string, string>()

// ─── 精确输入哈希（写/执行工具、MCP、技能） ───────────────

/**
 * 尝试自动批准（精确输入哈希）：查找并消费匹配的一次性能力令牌。
 * 返回 true 表示已自动批准，调用方应跳过审批对话框。
 */
export function tryAutoApprove(request: ToolRequest): boolean {
  const digest = hashToolRequest(request)
  const token = tokenByDigest.get(digest)
  if (!token) return false
  tokenByDigest.delete(digest)
  return authority.consume(token, request)
}

/**
 * 授予可复用审批（精确输入哈希）：用户批准后签发令牌，供下次相同调用自动批准。
 */
export function grantReusableApproval(request: ToolRequest): void {
  const digest = hashToolRequest(request)
  const token = authority.issue(request)
  tokenByDigest.set(digest, token)
}

// ─── 工具名级别（只读工具 mutates: false） ─────────────────

/**
 * 尝试自动批准（工具名级别）：60s 内同一工具的任意参数调用自动通过。
 * 内部使用 input: {} 使哈希仅依赖 tool + workspace。
 * 仅适用于只读工具（mutates: false）。
 */
export function tryAutoApproveByTool(tool: string, workspace: string): boolean {
  return tryAutoApprove({ tool, workspace, input: {} })
}

/**
 * 授予可复用审批（工具名级别）：用户批准只读工具后签发令牌，
 * 60s 内该工具的任意参数调用自动通过。
 */
export function grantReusableApprovalByTool(tool: string, workspace: string): void {
  grantReusableApproval({ tool, workspace, input: {} })
}
