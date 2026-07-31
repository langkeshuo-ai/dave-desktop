/* =========================================================================
   MCP 客户端管理器 —— 复用官方 @modelcontextprotocol/sdk。

   通过 stdio 传输连接外部 MCP server(如 filesystem/git/everything),
   发现其工具并以 `mcp__<server>__<tool>` 全名并入 agent 工具循环。
   MCP 工具一律走审批(见 chat-loop runToolCalls 的 MCP 分支)。
   ========================================================================= */

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { app } from "electron"
import log from "electron-log"
import {
  mcpToolName,
  splitMcpToolName,
  type McpDiscoveredTool,
  type McpServerConfig,
} from "../shared/mcp"

export interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: unknown
}

interface ConnectedServer {
  config: McpServerConfig
  client: Client
  tools: McpToolInfo[]
}

export class McpManager {
  private servers = new Map<string, ConnectedServer>()

  /** 连接单个服务器:spawn stdio → 握手 → 拉取工具列表。失败抛错(由调用方决定处理)。 */
  async connect(config: McpServerConfig): Promise<void> {
    await this.disconnect(config.name)
    const transport = new StdioClientTransport({ command: config.command, args: config.args })
    const client = new Client({ name: "dave-desktop", version: app.getVersion() })
    await client.connect(transport)
    const { tools } = await client.listTools()
    this.servers.set(config.name, {
      config,
      client,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    })
  }

  /** 断开单个服务器;未连接则 no-op。 */
  async disconnect(name: string): Promise<void> {
    const s = this.servers.get(name)
    if (!s) return
    this.servers.delete(name)
    try {
      await s.client.close()
    } catch {
      /* 关闭失败不阻断 */
    }
  }

  /** 全量重连:先断开所有,再逐个连接;单个失败不影响其他。 */
  async connectAll(configs: McpServerConfig[]): Promise<void> {
    for (const name of [...this.servers.keys()]) await this.disconnect(name)
    for (const cfg of configs) {
      try {
        await this.connect(cfg)
      } catch (err) {
        log.warn(
          `mcp: connect failed for ${cfg.name}:`,
          err instanceof Error ? err.message : String(err),
        )
      }
    }
  }

  /** 所有已连接服务器的工具清单(供 UI 展示与调试)。 */
  listTools(): McpDiscoveredTool[] {
    const out: McpDiscoveredTool[] = []
    for (const [server, s] of this.servers) {
      for (const tool of s.tools) {
        out.push({
          fullName: mcpToolName(server, tool.name),
          server,
          description: tool.description,
        })
      }
    }
    return out
  }

  /** 按 `mcp__server__tool` 全名查工具;非 MCP 名/未连接返回 null。 */
  getTool(fullName: string): { server: string; tool: McpToolInfo } | null {
    const parts = splitMcpToolName(fullName)
    if (!parts) return null
    const s = this.servers.get(parts.server)
    const tool = s?.tools.find((t) => t.name === parts.tool)
    return tool ? { server: parts.server, tool } : null
  }

  /** 调用 MCP 工具,返回拼接后的文本输出;失败抛错由调用方处理。 */
  async callTool(fullName: string, args: Record<string, unknown>): Promise<string> {
    const found = this.getTool(fullName)
    if (!found) throw new Error(`MCP 工具未连接:${fullName}`)
    const s = this.servers.get(found.server)
    if (!s) throw new Error(`MCP server 未连接:${found.server}`)
    const result = await s.client.callTool({ name: found.tool.name, arguments: args })
    // SDK 的 CallToolResult.content 类型推断为 {} ,显式标注便于 filter/map
    const content = (result.content ?? []) as Array<{ type?: string; text?: string }>
    const text = content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n")
    return text || "(MCP 工具无文本输出)"
  }

  /** 是否已连接某服务器。 */
  isConnected(name: string): boolean {
    return this.servers.has(name)
  }
}

/** 进程级单例,供 chat-loop 的 MCP 工具分支与 ipc 使用。 */
export const mcpManager = new McpManager()
