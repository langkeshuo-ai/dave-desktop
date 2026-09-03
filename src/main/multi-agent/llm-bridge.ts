/**
 * Multi-Agent LLM Bridge — 多 Agent LLM 调用桥接
 *
 * 为编排引擎提供 planGoal / executeTask / reviewResult / synthesize 四个 LLM 调用。
 * 复用现有 provider 基础设施（resolveEndpoint/resolveKey/resolveModel/buildHeaders），
 * 非流式调用，直接返回完整文本。
 *
 * 接入真实 LLM：每个 Agent 有独立 systemPrompt，用户消息包含任务上下文。
 */
import log from "electron-log"
import type { ChatMessage } from "../../shared/types"
import { getStore, getSecure } from "../store"
import { buildHeaders, isAnthropic, resolveEndpoint, resolveKey, resolveModel } from "../providers"
import { fetchPublicHttps } from "../provider-url-policy"
import { getTool, toolDefsFor } from "../agent"
import type { AgentDefinition, CollaborationTask } from "./types"
import { getAgentById } from "./agents"

// ─── 工具调用类型 ──────────────────────────────────────────

interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

interface LLMResponse {
  text: string
  toolCalls: ToolCall[]
}

// ─── 非流式 LLM 调用（支持工具） ───────────────────────────

interface LLMCallOptions {
  systemPrompt: string
  messages: ChatMessage[]
  /** 温度，默认 0.7 */
  temperature?: number
  /** 最大 token，默认 2048 */
  maxTokens?: number
  /** 工具定义（OpenAI format） */
  tools?: Record<string, unknown>[]
}

/**
 * 非流式调用 LLM，返回文本和工具调用。
 * 复用现有 provider 配置，支持 OpenAI 兼容和 Anthropic。
 */
async function callLLM(opts: LLMCallOptions): Promise<LLMResponse> {
  const store = getStore()
  const provider = (store.get("provider") as string) || "deepseek"
  const fallbackKey = ((await getSecure(`${provider}-api-key`)) || "").trim()
  const fallbackModel = (store.get("model") as string) || ""

  const endpoint = resolveEndpoint(provider, store)
  const key = resolveKey(provider, store, fallbackKey)
  const model = resolveModel(provider, store, fallbackModel)
  const headers = buildHeaders(provider, key)

  if (!key) {
    throw new Error(`未配置 ${provider} API Key，请在设置中配置`)
  }

  let body: string
  if (isAnthropic(provider)) {
    const system = opts.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n")
    const convo = opts.messages.filter((m) => m.role !== "system")
    body = JSON.stringify({
      model,
      max_tokens: opts.maxTokens ?? 2048,
      system,
      messages: convo,
      stream: false,
      temperature: opts.temperature ?? 0.7,
      ...(opts.tools ? { tools: opts.tools } : {}),
    })
  } else {
    body = JSON.stringify({
      model,
      messages: opts.messages,
      stream: false,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 2048,
      ...(opts.tools ? { tools: opts.tools, tool_choice: "auto" } : {}),
    })
  }

  const fetchFn = provider === "custom" ? fetchPublicHttps : fetch
  const response = await fetchFn(endpoint, {
    method: "POST",
    headers,
    body,
  })

  if (!response.ok) {
    const errBody = await response.text().catch(() => "unknown error")
    throw new Error(`LLM API 错误 (${response.status}): ${errBody.slice(0, 500)}`)
  }

  const data = await response.json()

  if (isAnthropic(provider)) {
    const text =
      (data.content?.find((c: { type: string }) => c.type === "text")?.text as string) || ""
    const toolCalls = (
      data.content?.filter((c: { type: string }) => c.type === "tool_use") || []
    ).map((tc: { id: string; name: string; input: Record<string, unknown> }) => ({
      id: tc.id,
      name: tc.name,
      arguments: tc.input,
    }))
    return { text, toolCalls }
  }

  const msg = data.choices?.[0]?.message
  const text = (msg?.content as string) || ""
  const toolCalls = (msg?.tool_calls || []).map(
    (tc: { id: string; function: { name: string; arguments: string } }) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: safeParseJSON(tc.function.arguments),
    }),
  )
  return { text, toolCalls }
}

function safeParseJSON(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str)
  } catch {
    return {}
  }
}

/**
 * 执行工具调用，返回工具结果文本。
 * 复用现有 agent.ts 的 TOOLS 注册表。
 */
async function executeToolCall(toolCall: ToolCall): Promise<string> {
  const tool = getTool(toolCall.name)
  if (!tool) {
    return `错误：未知工具 "${toolCall.name}"`
  }

  const workspace = (getStore().get("cwd") as string) || ""
  if (
    !workspace &&
    (tool.name === "read_file" ||
      tool.name === "write_file" ||
      tool.name === "apply_patch" ||
      tool.name === "shell")
  ) {
    return "错误：未配置工作区目录，请在设置中选择工作区"
  }

  try {
    const mode = (getStore().get("mode") as string) || "auto"
    const result = await tool.run(workspace, toolCall.arguments as never, mode as never)
    return result.ok ? result.output : `工具执行失败：${result.output}`
  } catch (err) {
    return `工具执行异常：${err instanceof Error ? err.message : String(err)}`
  }
}

/**
 * 带工具调用的 Agent Loop。
 * 反复调用 LLM → 执行工具 → 回灌结果，直到无工具调用或达到最大迭代数。
 */
async function runAgentWithTools(opts: {
  systemPrompt: string
  userMessage: string
  allowedTools?: string[]
  maxIterations?: number
  temperature?: number
  maxTokens?: number
}): Promise<string> {
  const maxIter = opts.maxIterations ?? 8
  const allToolDefs = toolDefsFor("openai")
  const toolDefs = opts.allowedTools
    ? allToolDefs.filter((t) => opts.allowedTools!.includes((t.function as { name: string }).name))
    : allToolDefs

  const messages: ChatMessage[] = [
    { role: "system", content: opts.systemPrompt },
    { role: "user", content: opts.userMessage },
  ]

  let fullText = ""

  for (let i = 0; i < maxIter; i++) {
    const response = await callLLM({
      systemPrompt: opts.systemPrompt,
      messages,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      temperature: opts.temperature ?? 0.7,
      maxTokens: opts.maxTokens ?? 2048,
    })

    if (response.text) {
      fullText += response.text
      messages.push({ role: "assistant", content: response.text })
    }

    if (response.toolCalls.length === 0) {
      break
    }

    // 执行所有工具调用
    for (const tc of response.toolCalls) {
      log.info(`[multi-agent] tool call: ${tc.name}`, JSON.stringify(tc.arguments).slice(0, 200))
      const result = await executeToolCall(tc)
      messages.push({
        role: "tool",
        content: result.slice(0, 8000), // 截断工具输出，防止上下文爆炸
        tool_call_id: tc.id,
      } as ChatMessage)
    }
  }

  return fullText || "（无输出）"
}

// ─── 编排引擎 LLM 接口 ─────────────────────────────────────

/**
 * CEO 制定计划：将目标分解为任务列表。
 * 使用 CEO 的 systemPrompt + 目标描述。
 */
export async function planGoal(
  goal: string,
  agents: AgentDefinition[],
): Promise<{ title: string; description: string; assignedAgentId: string }[]> {
  const ceo = agents.find((a) => a.role === "ceo") ?? getAgentById("ceo")!
  const specialistList = agents
    .filter((a) => a.role !== "ceo")
    .map((a) => `- ${a.name} (${a.role}): ${a.description}`)
    .join("\n")

  const userMessage = `## 目标
${goal}

## 可用团队成员
${specialistList}

## 任务
请将上述目标分解为 2-5 个具体任务，每个任务分配给最合适的团队成员。
要求：
1. 任务要具体、可执行、有明确产出
2. 任务之间可以有依赖关系
3. 每个任务只分配给一个成员

请以 JSON 数组格式返回，每个元素包含：
- title: 任务标题（简短）
- description: 任务描述（详细说明要做什么）
- assignedAgentId: 分配的成员 ID（${agents
    .filter((a) => a.role !== "ceo")
    .map((a) => a.id)
    .join(" / ")}）

只返回 JSON，不要其他文字。`

  try {
    const response = await callLLM({
      systemPrompt: ceo.systemPrompt,
      messages: [
        { role: "system", content: ceo.systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.3,
      maxTokens: 2048,
    })
    const result = response.text

    // 解析 JSON（容错：提取第一个 [ 到最后一个 ]）
    const jsonStart = result.indexOf("[")
    const jsonEnd = result.lastIndexOf("]")
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const jsonStr = result.slice(jsonStart, jsonEnd + 1)
      const tasks = JSON.parse(jsonStr) as Array<{
        title: string
        description: string
        assignedAgentId: string
      }>
      // 验证并过滤
      return tasks
        .filter((t) => t.title && t.description && t.assignedAgentId)
        .map((t) => ({
          title: String(t.title).slice(0, 100),
          description: String(t.description).slice(0, 500),
          assignedAgentId: String(t.assignedAgentId),
        }))
    }
  } catch (err) {
    log.warn(
      "[multi-agent] planGoal LLM call failed, using fallback:",
      err instanceof Error ? err.message : String(err),
    )
  }

  // Fallback：基于规则生成任务
  return fallbackPlanGoal(goal, agents)
}

function fallbackPlanGoal(
  goal: string,
  agents: AgentDefinition[],
): { title: string; description: string; assignedAgentId: string }[] {
  const specialists = agents.filter((a) => a.role !== "ceo")
  const tasks: { title: string; description: string; assignedAgentId: string }[] = []

  for (const agent of specialists.slice(0, 3)) {
    tasks.push({
      title: `${agent.name}任务`,
      description: `围绕"${goal}"完成${agent.description}相关工作。`,
      assignedAgentId: agent.id,
    })
  }

  return tasks.length > 0
    ? tasks
    : [
        {
          title: "执行目标",
          description: `完成目标：${goal}`,
          assignedAgentId: specialists[0]?.id ?? "ceo",
        },
      ]
}

/**
 * Specialist 执行任务：调用 LLM 生成任务结果。
 * 使用 Specialist 的 systemPrompt + 任务描述 + 上下文。
 */
export async function executeTask(
  task: CollaborationTask,
  agent: AgentDefinition,
  context: string,
): Promise<string> {
  const userMessage = `## 你的任务
${task.title}

${task.description}

## 项目上下文
${context}

## 要求
1. 仔细分析任务需求
2. 给出具体、可操作的结果
3. 如果需要写代码，给出完整代码
4. 如果需要分析，给出结构化的分析报告
5. 结果要详实，不要敷衍`

  try {
    // 有工具权限的 Agent（如程序员）使用工具循环
    if (agent.allowedTools && agent.allowedTools.length > 0) {
      const result = await runAgentWithTools({
        systemPrompt: agent.systemPrompt,
        userMessage,
        allowedTools: agent.allowedTools,
        maxIterations: 10,
        temperature: 0.7,
        maxTokens: 4096,
      })
      return result
    }

    // 无工具权限的 Agent 使用普通调用
    const response = await callLLM({
      systemPrompt: agent.systemPrompt,
      messages: [
        { role: "system", content: agent.systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.7,
      maxTokens: 4096,
    })
    return response.text || "（无输出）"
  } catch (err) {
    log.error("[multi-agent] executeTask failed:", err instanceof Error ? err.message : String(err))
    return `任务执行失败：${err instanceof Error ? err.message : String(err)}`
  }
}

/**
 * Reviewer 审查任务结果。
 * 使用 Reviewer 的 systemPrompt + 任务 + 结果。
 */
export async function reviewResult(
  task: CollaborationTask,
  result: string,
): Promise<{ passed: boolean; feedback: string }> {
  const reviewer = getAgentById("reviewer")!
  const userMessage = `## 审查任务
${task.title}

${task.description}

## 待审查结果
${result.slice(0, 3000)}

## 审查要求
请从以下维度审查：
1. 正确性：结果是否正确、有无错误
2. 完整性：是否覆盖了任务要求的所有方面
3. 质量：代码/文档/分析的质量如何
4. 可操作性：结果是否可以直接使用

请以 JSON 格式返回：
{
  "passed": true/false,
  "feedback": "审查反馈，具体说明问题或优点"
}

只返回 JSON，不要其他文字。`

  try {
    const response = await callLLM({
      systemPrompt: reviewer.systemPrompt,
      messages: [
        { role: "system", content: reviewer.systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.2,
      maxTokens: 1024,
    })
    const result = response.text

    const jsonStart = result.indexOf("{")
    const jsonEnd = result.lastIndexOf("}")
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const parsed = JSON.parse(result.slice(jsonStart, jsonEnd + 1)) as {
        passed: boolean
        feedback: string
      }
      return {
        passed: Boolean(parsed.passed),
        feedback: String(parsed.feedback || "无反馈"),
      }
    }
  } catch (err) {
    log.warn("[multi-agent] reviewResult failed:", err instanceof Error ? err.message : String(err))
  }

  // Fallback：默认通过
  return { passed: true, feedback: "自动通过（审查调用失败）" }
}

/**
 * CEO 汇总最终结果。
 * 使用 CEO 的 systemPrompt + 所有任务结果。
 */
export async function synthesize(goal: string, tasks: CollaborationTask[]): Promise<string> {
  const ceo = getAgentById("ceo")!
  const taskSummaries = tasks
    .map((t, i) => {
      const agent = getAgentById(t.assignedAgentId)
      return `### 任务 ${i + 1}: ${t.title}
**负责人**: ${agent?.name ?? t.assignedAgentId}
**状态**: ${t.status}
**结果**:
${(t.result || "（无结果）").slice(0, 1500)}`
    })
    .join("\n\n")

  const userMessage = `## 原始目标
${goal}

## 各任务结果
${taskSummaries}

## 你的任务
作为 CEO，请汇总所有任务结果，给出最终交付物。
要求：
1. 结构化呈现最终结果
2. 突出关键成果和决策
3. 指出未解决的问题和后续建议
4. 如果有代码，汇总关键代码片段
5. 语言要专业、简洁`

  try {
    const response = await callLLM({
      systemPrompt: ceo.systemPrompt,
      messages: [
        { role: "system", content: ceo.systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.5,
      maxTokens: 4096,
    })
    return response.text || "（汇总失败）"
  } catch (err) {
    log.error("[multi-agent] synthesize failed:", err instanceof Error ? err.message : String(err))
    return `汇总失败：${err instanceof Error ? err.message : String(err)}`
  }
}

// ─── 协商/辩论机制 ──────────────────────────────────────────

export interface NegotiationResult {
  passed: boolean
  result: string
  rounds: number
  specialistResponse: string
  reviewerFinalFeedback: string
}

/**
 * 协商/辩论：Reviewer 驳回后，Specialist 辩护，Reviewer 复审。
 * 最多 2 轮协商，仍不通过则返回 failed，由 CEO 裁决或升级用户。
 */
export async function negotiate(
  task: CollaborationTask,
  originalResult: string,
  reviewerFeedback: string,
  maxRounds = 2,
): Promise<NegotiationResult> {
  const specialist = getAgentById(task.assignedAgentId)
  const reviewer = getAgentById("reviewer")

  if (!specialist || !reviewer) {
    return {
      passed: false,
      result: originalResult,
      rounds: 0,
      specialistResponse: "",
      reviewerFinalFeedback: reviewerFeedback,
    }
  }

  let currentResult = originalResult
  let currentFeedback = reviewerFeedback
  let specialistResponse = ""

  for (let round = 1; round <= maxRounds; round++) {
    // 1. Specialist 回应审查反馈（辩护或修改）
    const defensePrompt = `## 你的任务
${task.title}

${task.description}

## 你之前的结果
${currentResult.slice(0, 3000)}

## 审查员的反馈
${currentFeedback}

## 你的任务
请回应审查员的反馈：
1. 如果反馈合理，请修改你的结果并给出修正版
2. 如果反馈不合理，请辩护说明为什么你的结果是正确的
3. 给出你的最终回应（可以是修改后的结果，也可以是辩护说明）`

    const defenseResponse = await callLLM({
      systemPrompt: specialist.systemPrompt,
      messages: [
        { role: "system", content: specialist.systemPrompt },
        { role: "user", content: defensePrompt },
      ],
      temperature: 0.5,
      maxTokens: 3000,
    })
    specialistResponse = defenseResponse.text

    // 如果 Specialist 给出了修改版，用修改版作为新结果
    if (defenseResponse.text.length > 100) {
      currentResult = defenseResponse.text
    }

    // 2. Reviewer 复审
    const reReviewPrompt = `## 任务
${task.title}

${task.description}

## 原始结果
${originalResult.slice(0, 2000)}

## 你之前的审查反馈
${currentFeedback}

## 负责人的回应
${specialistResponse.slice(0, 3000)}

## 你的任务
请重新审查：
1. 负责人的回应是否解决了你的顾虑？
2. 修改后的结果是否符合要求？
3. 给出最终审查结论

请以 JSON 格式返回：
{
  "passed": true/false,
  "feedback": "最终审查反馈"
}

只返回 JSON，不要其他文字。`

    const reReviewResponse = await callLLM({
      systemPrompt: reviewer.systemPrompt,
      messages: [
        { role: "system", content: reviewer.systemPrompt },
        { role: "user", content: reReviewPrompt },
      ],
      temperature: 0.2,
      maxTokens: 1024,
    })

    // 解析 JSON
    const jsonStart = reReviewResponse.text.indexOf("{")
    const jsonEnd = reReviewResponse.text.lastIndexOf("}")
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      try {
        const parsed = JSON.parse(reReviewResponse.text.slice(jsonStart, jsonEnd + 1)) as {
          passed: boolean
          feedback: string
        }
        currentFeedback = parsed.feedback
        if (parsed.passed) {
          return {
            passed: true,
            result: currentResult,
            rounds: round,
            specialistResponse,
            reviewerFinalFeedback: parsed.feedback,
          }
        }
      } catch {
        // JSON 解析失败，继续下一轮
      }
    }
  }

  // 协商失败
  return {
    passed: false,
    result: currentResult,
    rounds: maxRounds,
    specialistResponse,
    reviewerFinalFeedback: currentFeedback,
  }
}

/**
 * CEO 裁决：协商失败后，CEO 综合双方观点做最终决定。
 */
export async function ceoDecide(
  task: CollaborationTask,
  originalResult: string,
  reviewerFeedback: string,
  specialistResponse: string,
): Promise<{ passed: boolean; result: string; decision: string }> {
  const ceo = getAgentById("ceo")!

  const prompt = `## 任务
${task.title}

${task.description}

## 负责人的结果
${originalResult.slice(0, 2000)}

## 审查员的反馈
${reviewerFeedback}

## 负责人的辩护/修改
${specialistResponse.slice(0, 2000)}

## 你的任务
作为 CEO，请综合双方观点做最终裁决：
1. 负责人的结果是否可以接受？
2. 审查员的反馈是否合理？
3. 给出你的最终决定和理由

请以 JSON 格式返回：
{
  "passed": true/false,
  "result": "最终结果（如果需要修改，给出修改版）",
  "decision": "裁决理由"
}

只返回 JSON，不要其他文字。`

  const response = await callLLM({
    systemPrompt: ceo.systemPrompt,
    messages: [
      { role: "system", content: ceo.systemPrompt },
      { role: "user", content: prompt },
    ],
    temperature: 0.3,
    maxTokens: 2048,
  })

  const jsonStart = response.text.indexOf("{")
  const jsonEnd = response.text.lastIndexOf("}")
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(response.text.slice(jsonStart, jsonEnd + 1)) as {
        passed: boolean
        result: string
        decision: string
      }
      return {
        passed: Boolean(parsed.passed),
        result: parsed.result || originalResult,
        decision: parsed.decision || "CEO 裁决",
      }
    } catch {
      // fall through
    }
  }

  // 默认通过（CEO 倾向于推进）
  return { passed: true, result: originalResult, decision: "CEO 裁决通过" }
}
