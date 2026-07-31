// 最小 MCP stdio server(集成测试 fixture):注册 echo / add 两个工具。
// 由测试用 process.execPath 启动,验证 mcpManager 的工具发现与调用链路。
// SDK v1.30 的 setRequestHandler 要求 zod request schema(ListToolsRequestSchema 等)。
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js"

const server = new Server(
  { name: "echo-test-server", version: "1.0.0" },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "echo",
      description: "回显输入文本",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
      },
    },
    {
      name: "add",
      description: "两数相加",
      inputSchema: {
        type: "object",
        properties: { a: { type: "number" }, b: { type: "number" } },
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params
  if (name === "echo") {
    return { content: [{ type: "text", text: String(args?.text ?? "") }] }
  }
  if (name === "add") {
    const a = typeof args?.a === "number" ? args.a : 0
    const b = typeof args?.b === "number" ? args.b : 0
    return { content: [{ type: "text", text: String(a + b) }] }
  }
  return { content: [{ type: "text", text: `unknown tool ${name}` }], isError: true }
})

await server.connect(new StdioServerTransport())
