/* =========================================================================
   Store key whitelist + session title sanitization — pure functions shared
   between main (ipc.ts) and tests. 与 shell-policy.ts 对称:把 IPC 边界的
   输入校验逻辑抽到 shared 层,让 main 层只做 adapter,node 环境可直接单测。
   ========================================================================= */

// store key 白名单:渲染端只能读写已知 key,防止被注入未知 key 撑爆
// electron-store 文件或写入业务无关字段(如 __proto__ / __pollution__ 等)。
// ${provider}-api-key 模式覆盖所有 provider 变体(openai/anthropic/deepseek/custom)。
const STORE_KEY_WHITELIST = new Set<string>([
  "theme",
  "cwd",
  "mode",
  "last-session-id",
  "provider",
  "custom-host",
  "custom-model",
  "custom-api-key",
  "openai-api-key",
  "anthropic-api-key",
  "deepseek-api-key",
  "onboarding_completed",
  "onboarding_skipped",
  // MCP 服务器配置(JSON 数组,见 shared/mcp.ts;写操作走 mcp-servers-set IPC)
  "mcp-servers",
  // electron-log 输出级别(见 shared/log-level.ts;logs-set-level IPC 写入)
  "log-level",
  // 用户自定义技能(JSON 数组,见 shared/skills.ts;写操作走 skills-set IPC)
  "skills",
])

const STORE_KEY_API_KEY_RE = /^(openai|anthropic|deepseek|custom)-api-key$/

/** 校验渲染端传入的 store key 是否在白名单内。
 *  - 非字符串 / 空 / 超长(>64) 一律拒绝
 *  - 命中白名单或匹配 ${provider}-api-key 模式则放行 */
export function isAllowedStoreKey(key: unknown): key is string {
  if (typeof key !== "string" || key.length === 0 || key.length > 64) return false
  if (STORE_KEY_WHITELIST.has(key)) return true
  return STORE_KEY_API_KEY_RE.test(key)
}

/** store-set value 长度上限:16K,防止渲染端写超长字符串撑爆 store 文件。 */
export const STORE_VALUE_MAX = 16_384

// session title 长度上限:autoTitleSession 用 slice(0, 40) 截断,
// 用户手动重命名允许稍长(80),超长截断,空或非字符串则返回 null 表示忽略。
export const SESSION_TITLE_MAX = 80

/** 清洗渲染端传入的 session title。
 *  - 非字符串 / trim 后为空 → 返回 null(调用方应忽略)
 *  - 超长 → 截断到 SESSION_TITLE_MAX
 *  - 正常 → trim 后返回
 *  返回 null 表示"不应更新",调用方据此短路。 */
export function sanitizeSessionTitle(title: unknown): string | null {
  if (typeof title !== "string") return null
  const trimmed = title.trim()
  if (trimmed.length === 0) return null
  return trimmed.slice(0, SESSION_TITLE_MAX)
}
