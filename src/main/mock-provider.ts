/* =========================================================================
   Mock provider —— 免真实 API Key 的 E2E 全链路测试模式(R2)。

   仅当环境变量 DAVE_TEST_MOCK_PROVIDER=1 时由 chat-loop 的 handleChatStream
   启用:主进程完全走本地模拟(不触网、不需 key/workspace),渲染端 UI 链路
   (流式 chunk / 工具事件 / 审批弹窗 / patch 预览 / done)全部真实覆盖。
   生产环境无该变量,行为零变化。

   纯函数部分(node 环境可单测)与编排逻辑分离;编排在 chat-loop.ts。
   ========================================================================= */

export const MOCK_PROVIDER = "mock"

/** 是否启用 mock provider(仅测试环境)。 */
export function isMockMode(): boolean {
  return process.env.DAVE_TEST_MOCK_PROVIDER === "1"
}

/**
 * 纯函数:mock 回复文本。
 * 回显用户输入便于 E2E 断言(等待该文本出现即代表流式链路完成)。
 */
export function mockReplyText(userMessage: string, mode: string): string {
  const modeNote = mode === "ask" ? "" : `（mock 工具轮已完成，模式=${mode}）`
  return `这是 mock 回复：${userMessage} ${modeNote}`.trim()
}

/** mock agent 脚本计划:一轮工具 + 一轮最终回复。 */
export interface MockAgentTurn {
  /** 使用的真实工具名(UI 有 label/icon/desc,审批弹窗展示完整)。 */
  tool: string
  approvalArgs: Record<string, unknown>
  /** 合法最小 unified diff,驱动渲染端 patch 预览链路。 */
  patch: string
  patchPaths: string[]
}

/** 纯函数:构造 mock 工具轮脚本(可单测)。 */
export function buildMockAgentScript(_mode: string, _workspace: string): MockAgentTurn {
  return {
    tool: "file_tree",
    approvalArgs: { depth: 1 },
    patch: ["--- a/mock.md", "+++ b/mock.md", "@@ -0,0 +1,1 @@", "+mock 内容"].join("\n"),
    patchPaths: ["mock.md"],
  }
}
