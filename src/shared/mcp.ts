/* =========================================================================
   MCP(Model Context Protocol)工具集成 —— shared 纯函数与类型。

   复用官方 @modelcontextprotocol/sdk(MIT,活跃维护,2026-07-27 v1.30.0)。
   工具命名规范:`mcp__<server>__<tool>`,与内置工具(如 toolShell)隔离,
   避免命名冲突;splitMcpToolName 反解出 server/tool 供客户端路由。
   纯函数(node 环境可单测),main 层只做 adapter。
   ========================================================================= */

export interface McpServerConfig {
  name: string
  command: string
  args: string[]
}

export const MCP_TOOL_PREFIX = "mcp__"
const SERVER_NAME_RE = /^[a-zA-Z0-9_-]{1,48}$/

/** 是否为 MCP 动态工具名(mcp__ 前缀)。 */
export function isMcpToolName(name: string): boolean {
  return name.startsWith(MCP_TOOL_PREFIX)
}

/** 由 server + tool 生成全名。 */
export function mcpToolName(server: string, tool: string): string {
  return `${MCP_TOOL_PREFIX}${server}__${tool}`
}

/** 反解全名为 { server, tool };非法格式返回 null。 */
export function splitMcpToolName(name: string): { server: string; tool: string } | null {
  if (!isMcpToolName(name)) return null
  const rest = name.slice(MCP_TOOL_PREFIX.length)
  const idx = rest.indexOf("__")
  if (idx <= 0 || idx >= rest.length - 2) return null
  return { server: rest.slice(0, idx), tool: rest.slice(idx + 2) }
}

/** 校验单个 MCP 服务器配置;非法返回 null。 */
export function validateMcpServerConfig(cfg: unknown): McpServerConfig | null {
  if (typeof cfg !== "object" || cfg === null) return null
  const { name, command, args } = cfg as Record<string, unknown>
  if (typeof name !== "string" || !SERVER_NAME_RE.test(name)) return null
  if (typeof command !== "string" || command.trim().length === 0 || command.length > 256) {
    return null
  }
  if (args !== undefined && !Array.isArray(args)) return null
  const argList: string[] = Array.isArray(args)
    ? args.filter((a): a is string => typeof a === "string" && a.length <= 256)
    : []
  return { name, command: command.trim(), args: argList }
}

/** 解析渲染端传入的服务器列表:过滤非法项 + 去重(同名只保留首个)。 */
export function parseMcpServers(raw: unknown): McpServerConfig[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: McpServerConfig[] = []
  for (const item of raw) {
    const cfg = validateMcpServerConfig(item)
    if (!cfg || seen.has(cfg.name)) continue
    seen.add(cfg.name)
    out.push(cfg)
  }
  return out
}

/** 已发现的 MCP 工具(供 UI 展示与调试)。 */
export interface McpDiscoveredTool {
  fullName: string
  server: string
  description?: string
}
