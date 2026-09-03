/* =========================================================================
   Chat agent loop — streaming, tools, approval, abort.
   ========================================================================= */

import type { IpcMainInvokeEvent } from "electron"
import log from "electron-log"
import type { AgentMode, ChatMessage } from "../shared/types"
import { clampToolOutput, truncateMessages } from "../shared/context"
import { SseParser } from "../shared/sse-parser"
import { getStore, getSecure } from "./store"
import { pushWithGuard } from "./security/ipc-guard"
import {
  anthropicToMessage,
  buildAgentBody,
  buildHeaders,
  buildStreamBody,
  extractDelta,
  isAnthropic,
  openAiToMessage,
  resolveEndpoint,
  resolveKey,
  resolveModel,
} from "./providers"
import { autoTitleSession, getSessionMessages, saveSessionMessages } from "./session"
import { sessionRuntime } from "./session-runtime"
import { fetchPublicHttps } from "./provider-url-policy"
import { isMockMode, mockReplyText, buildMockAgentScript } from "./mock-provider"
import { mcpManager } from "./mcp-client"
import { isMcpToolName } from "../shared/mcp"
import {
  isSkillToolName,
  parseSkills,
  skillToolCallOutcome,
  skillToolDefs,
  type SkillDefinition,
} from "../shared/skills"
import { getTool, needsApproval, toolDefsFor, type ToolResult } from "./agent"
import {
  grantReusableApproval,
  grantReusableApprovalByTool,
  tryAutoApprove,
  tryAutoApproveByTool,
} from "./tool-approval-cache"

const partialBySession = new Map<string, string>()

export function resolveApproval(sessionId: string, approved: boolean): void {
  sessionRuntime.resolveApproval(sessionId, approved)
}

export function abortSession(sessionId: string): void {
  sessionRuntime.abortSession(sessionId)
}

function fetchWithAbort(
  sessionId: string,
  provider: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const signal = sessionRuntime.beginAbortScope(sessionId)
  const request = { ...init, signal }
  return provider === "custom" ? fetchPublicHttps(url, request) : fetch(url, request)
}

/**
 * Emit already-known final text as synthetic stream chunks (no second API call).
 * Avoids double-billing and answer drift from the old streamFinal re-request pattern.
 */
async function emitLocalStream(
  event: IpcMainInvokeEvent,
  sessionId: string,
  text: string,
): Promise<void> {
  if (!text) return
  const chunkSize = 24
  let emitted = ""
  for (let i = 0; i < text.length; i += chunkSize) {
    if (sessionRuntime.getSignal(sessionId)?.aborted) {
      throw new DOMException("aborted", "AbortError")
    }
    const content = text.slice(i, i + chunkSize)
    emitted += content
    partialBySession.set(sessionId, emitted)
    pushWithGuard(event.sender, "chat-stream-chunk", { content, sessionId })
    await new Promise((r) => setTimeout(r, 0))
  }
}

async function streamFromProvider(
  event: IpcMainInvokeEvent,
  sessionId: string,
  provider: string,
  endpoint: string,
  headers: Record<string, string>,
  body: string,
): Promise<string> {
  const response = await fetchWithAbort(sessionId, provider, endpoint, {
    method: "POST",
    headers,
    body,
  })
  if (!response.ok) {
    const errBody = await response.text().catch(() => "unknown error")
    throw new Error(`API 错误 (${response.status}): ${errBody}`)
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error("无法读取响应流")
  const decoder = new TextDecoder()
  const parser = new SseParser()
  let full = ""
  const consume = (events: Array<{ data: string }>) => {
    for (const { data } of events) {
      if (data === "[DONE]") continue
      try {
        const content = extractDelta(provider, JSON.parse(data))
        if (!content) continue
        full += content
        partialBySession.set(sessionId, full)
        pushWithGuard(event.sender, "chat-stream-chunk", { content, sessionId })
      } catch {
        log.warn("ignored malformed SSE data event")
      }
    }
  }
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    consume(parser.push(decoder.decode(value, { stream: true })))
  }
  consume(parser.push(decoder.decode(), true))
  return full
}

function getSessionWorkspace(): string {
  return (getStore().get("cwd") as string) || ""
}

function getSessionMode(): AgentMode {
  return (getStore().get("mode") as AgentMode) || "ask"
}

function finishOk(event: IpcMainInvokeEvent, sessionId: string): void {
  partialBySession.delete(sessionId)
  sessionRuntime.clearAbort(sessionId)
  pushWithGuard(event.sender, "chat-stream-done", { sessionId })
}

function finishErr(event: IpcMainInvokeEvent, sessionId: string, error: string): void {
  partialBySession.delete(sessionId)
  sessionRuntime.clearAbort(sessionId)
  pushWithGuard(event.sender, "chat-stream-error", { error, sessionId })
}

/** 统一失败处理:AbortError → 保存 partial 并发 `done { aborted: true }`;
 *  其他错误 → `chat-stream-error`。真实路径与 mock 路径共用,语义一致。 */
function handleStreamFailure(event: IpcMainInvokeEvent, sessionId: string, err: unknown): void {
  if (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && (err.name === "AbortError" || /aborted/i.test(err.message)))
  ) {
    const partial = partialBySession.get(sessionId) || ""
    partialBySession.delete(sessionId)
    if (partial) {
      const persisted = getSessionMessages(sessionId)
      persisted.push({ role: "assistant", content: partial })
      saveSessionMessages(sessionId, persisted)
    }
    sessionRuntime.clearAbort(sessionId)
    pushWithGuard(event.sender, "chat-stream-done", { sessionId, aborted: true })
    return
  }
  const erroredPartial = partialBySession.get(sessionId) || ""
  partialBySession.delete(sessionId)
  // 错误收尾先抢救已流出的 partial：用户已看到的部分回复必须落库（与 aborted 路径对称）
  if (erroredPartial) {
    const persisted = getSessionMessages(sessionId)
    const last = persisted[persisted.length - 1]
    if (!(last?.role === "assistant" && last.content === erroredPartial)) {
      persisted.push({ role: "assistant", content: erroredPartial })
      saveSessionMessages(sessionId, persisted)
    }
  }
  const msg = err instanceof Error ? err.message : String(err)
  log.error("chat-stream failure:", msg)
  finishErr(event, sessionId, msg)
}

/** ask mode — single streamed call, no tools. */
async function runAskMode(
  event: IpcMainInvokeEvent,
  sessionId: string,
  provider: string,
  model: string,
  messages: ChatMessage[],
  endpoint: string,
  headers: Record<string, string>,
): Promise<void> {
  const full = await streamFromProvider(
    event,
    sessionId,
    provider,
    endpoint,
    headers,
    buildStreamBody(provider, model, messages),
  )
  messages.push({ role: "assistant", content: full })
  partialBySession.delete(sessionId)
  saveSessionMessages(sessionId, messages)
  autoTitleSession(sessionId, messages)
  finishOk(event, sessionId)
}

/** 软上限 — 模型故障时循环兜底,避免烧 token / 内存。 */
const MAX_AGENT_ITERATIONS = 50

/** 从 store 读取技能列表(损坏配置静默返回空)。 */
function readSkillsFromStore(): SkillDefinition[] {
  try {
    const raw = getStore().get("skills") as string | undefined
    return parseSkills(raw ? (JSON.parse(raw) as unknown) : [])
  } catch {
    return []
  }
}

/** suggest / auto / full-auto — agent tool loop, with a hard iteration cap. */
async function runAgentLoop(
  event: IpcMainInvokeEvent,
  sessionId: string,
  provider: string,
  model: string,
  mode: AgentMode,
  workspace: string,
  messages: ChatMessage[],
  endpoint: string,
  headers: Record<string, string>,
): Promise<void> {
  const tools = [...toolDefsFor(provider), ...skillToolDefs(readSkillsFromStore())]
  let iteration = 0

  while (true) {
    if (++iteration > MAX_AGENT_ITERATIONS) {
      finishErr(
        event,
        sessionId,
        `agent 循环已达上限 ${MAX_AGENT_ITERATIONS} 轮 — 终止以保护 token / 内存`,
      )
      return
    }
    // 中途被中止时(用户点"停止" / abort 已被触发),不要进入下一轮 fetch;
    // 抛 AbortError 让 handleChatStream 的 catch 统一发 `chat-stream-done { aborted: true }`,
    // 否则新一轮 beginAbortScope 会替换 controller,新 signal 不带 aborted,
    // 循环无法收敛。
    if (sessionRuntime.getSignal(sessionId)?.aborted) {
      throw new DOMException("aborted", "AbortError")
    }
    const body = buildAgentBody(provider, model, truncateMessages(messages), tools)
    const resp = await fetchWithAbort(sessionId, provider, endpoint, {
      method: "POST",
      headers,
      body,
    })

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "unknown error")
      finishErr(event, sessionId, `API 错误 (${resp.status}): ${errBody}`)
      return
    }

    const parsed = await resp.json()
    const assistantMsg: ChatMessage = isAnthropic(provider)
      ? anthropicToMessage(parsed)
      : openAiToMessage(parsed)

    const hasToolCalls = !!assistantMsg.tool_calls?.length
    if (!hasToolCalls) {
      if (assistantMsg.content) {
        await emitLocalStream(event, sessionId, assistantMsg.content)
      } else {
        assistantMsg.content = await streamFromProvider(
          event,
          sessionId,
          provider,
          endpoint,
          headers,
          buildStreamBody(provider, model, [...messages, { role: "assistant", content: "" }]),
        )
      }
      messages.push(assistantMsg)
      saveSessionMessages(sessionId, messages)
      autoTitleSession(sessionId, messages)
      finishOk(event, sessionId)
      return
    }

    pushWithGuard(event.sender, "chat-stream-tools", {
      sessionId,
      tools: assistantMsg.tool_calls!.map((tc) => tc.function.name),
    })

    messages.push(assistantMsg)
    await runToolCalls(event, sessionId, mode, workspace, messages, assistantMsg.tool_calls!)
    saveSessionMessages(sessionId, messages)
  }
}

/** Execute each tool_call, append tool results to messages. */
async function runToolCalls(
  event: IpcMainInvokeEvent,
  sessionId: string,
  mode: AgentMode,
  workspace: string,
  messages: ChatMessage[],
  toolCalls: NonNullable<ChatMessage["tool_calls"]>,
): Promise<void> {
  for (const tc of toolCalls) {
    // 会话已中止时不要继续等批准 / 执行工具,避免一个 10 个工具的 batch
    // 在用户点停止后被 5 分钟超时串行卡住(总等待 = 50 分钟)。
    // 抛 AbortError 让外层 handleChatStream 的 catch 统一发
    // `chat-stream-done { aborted: true }`,渲染端才能保存 streamingContent。
    if (sessionRuntime.getSignal(sessionId)?.aborted) {
      throw new DOMException("aborted", "AbortError")
    }
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>
    } catch {
      log.debug("malformed tool_call arguments from LLM:", tc.function.arguments)
      args = {}
    }

    const tool = getTool(tc.function.name)
    if (!tool && isMcpToolName(tc.function.name)) {
      // MCP 动态工具(来自外部 MCP server):一律审批后调用。
      // 保守策略:MCP 工具可能读写外部系统,视为 mutates,任何模式都需批准。
      const mcpRequest = { tool: tc.function.name, workspace, input: args }
      let approved = tryAutoApprove(mcpRequest)
      if (!approved) {
        pushWithGuard(event.sender, "chat-stream-approval", {
          sessionId,
          tool: tc.function.name,
          arguments: args,
          mutates: true,
          isShell: false,
        })
        approved = await sessionRuntime.waitApproval(sessionId)
        if (approved) grantReusableApproval(mcpRequest)
      }
      if (!approved) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          name: tc.function.name,
          content: "用户拒绝了此操作（或会话已中止）",
        })
        continue
      }
      try {
        const output = await mcpManager.callTool(tc.function.name, args)
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          name: tc.function.name,
          content: clampToolOutput(output),
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          name: tc.function.name,
          content: `工具失败：${msg}`,
        })
      }
      continue
    }
    if (!tool && isSkillToolName(tc.function.name)) {
      // 技能内容为任意 prompt 文本(潜在提示注入载体),任何模式启用前必须人工确认;
      // 与 MCP 分支一致的无条件审批策略(mutates:false 也不跳过)。
      // 决策逻辑抽为纯函数 skillToolCallOutcome(可单测);未知技能不触发审批。
      const skills = readSkillsFromStore()
      const pre = skillToolCallOutcome(tc.function.name, skills, false)
      if (pre.kind === "not-found") {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          name: tc.function.name,
          content: pre.content,
        })
        continue
      }
      const skillRequest = { tool: tc.function.name, workspace, input: args }
      let approved = tryAutoApprove(skillRequest)
      if (!approved) {
        pushWithGuard(event.sender, "chat-stream-approval", {
          sessionId,
          tool: tc.function.name,
          arguments: args,
          mutates: false,
          isShell: false,
        })
        approved = await sessionRuntime.waitApproval(sessionId)
        if (approved) grantReusableApproval(skillRequest)
      }
      const final = skillToolCallOutcome(tc.function.name, skills, approved)
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        name: tc.function.name,
        content: clampToolOutput(final.content),
      })
      continue
    }
    if (!tool) {
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        name: tc.function.name,
        content: `错误：未知工具 ${tc.function.name}`,
      })
      continue
    }

    if (needsApproval(tool, mode, args)) {
      // 分级缓存策略：
      // - 只读工具(mutates:false) → 工具名级别，60s 内任意参数自动通过
      // - 写/执行工具(mutates:true) → 精确输入哈希，仅完全相同的调用自动通过
      const isReadOnly = !tool.mutates
      let approved = isReadOnly
        ? tryAutoApproveByTool(tool.name, workspace)
        : tryAutoApprove({ tool: tool.name, workspace, input: args })
      if (!approved) {
        pushWithGuard(event.sender, "chat-stream-approval", {
          sessionId,
          tool: tool.name,
          arguments: args,
          mutates: tool.mutates,
          isShell: tool.isShell,
        })
        approved = await sessionRuntime.waitApproval(sessionId)
        if (approved) {
          if (isReadOnly) {
            grantReusableApprovalByTool(tool.name, workspace)
          } else {
            grantReusableApproval({ tool: tool.name, workspace, input: args })
          }
        }
      }
      if (!approved) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          name: tool.name,
          content: "用户拒绝了此操作（或会话已中止）",
        })
        continue
      }
    }

    try {
      const result: ToolResult = await tool.run(workspace, args, mode)
      if (result.patch) {
        pushWithGuard(event.sender, "chat-stream-patch", {
          sessionId,
          patch: result.patch,
          paths: result.paths,
        })
      }
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        name: tool.name,
        content: clampToolOutput(result.output),
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        name: tool.name,
        content: `工具失败：${msg}`,
      })
    }
  }
}

/** mock provider 编排:一轮工具(审批/patch)+ 一轮最终流式回复。
 *  不触网、不需 API Key / workspace,渲染端 UI 链路(chunk/tools/approval/
 *  patch/done)全真实。abort / error 语义与真实路径一致(抛给 handleStreamFailure)。 */
async function runMockStream(
  event: IpcMainInvokeEvent,
  sessionId: string,
  messages: ChatMessage[],
  userText: string,
): Promise<void> {
  const mode = getSessionMode()
  const script = buildMockAgentScript(mode, getSessionWorkspace())

  if (mode !== "ask") {
    // 轮 1:模拟工具调用 + 审批 + patch 预览
    pushWithGuard(event.sender, "chat-stream-tools", { sessionId, tools: [script.tool] })
    pushWithGuard(event.sender, "chat-stream-approval", {
      sessionId,
      tool: script.tool,
      arguments: script.approvalArgs,
      mutates: false,
      isShell: false,
    })
    const approved = await sessionRuntime.waitApproval(sessionId)
    messages.push({
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "mock_call_1",
          type: "function" as const,
          function: { name: script.tool, arguments: JSON.stringify(script.approvalArgs) },
        },
      ],
    })
    if (approved) {
      pushWithGuard(event.sender, "chat-stream-patch", {
        sessionId,
        patch: script.patch,
        paths: script.patchPaths,
      })
      messages.push({
        role: "tool",
        tool_call_id: "mock_call_1",
        name: script.tool,
        content: "mock: file_tree 返回 1 个条目（未真实执行）",
      })
    } else {
      messages.push({
        role: "tool",
        tool_call_id: "mock_call_1",
        name: script.tool,
        content: "用户拒绝了此操作（或会话已中止）",
      })
    }
    saveSessionMessages(sessionId, messages)
  }

  // 轮 2:最终回复流式输出
  const reply = mockReplyText(userText, mode)
  await emitLocalStream(event, sessionId, reply)
  messages.push({ role: "assistant", content: reply })
  saveSessionMessages(sessionId, messages)
  autoTitleSession(sessionId, messages)
  finishOk(event, sessionId)
}

export async function handleChatStream(
  event: IpcMainInvokeEvent,
  message: string,
  sessionId: string,
): Promise<void> {
  if (isMockMode()) {
    // mock 模式:不需 API Key / workspace,直接走本地模拟全链路。
    log.info(`mock-mode: sessionId=${sessionId} message=${message.slice(0, 40)}`)
    const mockMessages = truncateMessages(getSessionMessages(sessionId))
    mockMessages.push({ role: "user", content: message })
    saveSessionMessages(sessionId, mockMessages)
    log.info(`mock-mode: saved user msg, count=${mockMessages.length}`)
    partialBySession.delete(sessionId)
    // 先播种流式开始事件，满足时序守卫（chunk 守卫通道需 start 先行）
    pushWithGuard(event.sender, "chat-stream-start", { sessionId })
    try {
      await runMockStream(event, sessionId, mockMessages, message)
      log.info(`mock-mode: runMockStream finished for ${sessionId}`)
    } catch (err) {
      log.warn("mock-mode: runMockStream failed:", err instanceof Error ? err.message : String(err))
      handleStreamFailure(event, sessionId, err)
    }
    return
  }

  const store = getStore()
  const provider = (store.get("provider") as string) || "openai"
  // 使用 secure storage 读取 API Key(支持 safeStorage 解密)
  // getSecure 通过顶层 static import 加载,由 Node 模块缓存保证零额外开销
  const storedKey = ((await getSecure(`${provider}-api-key`)) || "").trim()
  const model = resolveModel(provider, store, (store.get(`${provider}-model`) as string) || "")
  // resolveKey handles custom-api-key alias; never ship empty Bearer headers.
  const key = resolveKey(provider, store, storedKey)
  if (!key) {
    pushWithGuard(event.sender, "chat-stream-error", {
      error: "请先在设置中配置 API 密钥",
      sessionId,
    })
    return
  }

  const mode = getSessionMode()
  // ask mode still streams without tools; workspace only required for agent modes.
  const workspace = mode === "ask" ? "" : getSessionWorkspace()
  if (mode !== "ask" && !workspace) {
    pushWithGuard(event.sender, "chat-stream-error", {
      error: "工作区未配置 — 请在设置中选择工作区目录",
      sessionId,
    })
    return
  }

  const messages = truncateMessages(getSessionMessages(sessionId))
  messages.push({ role: "user", content: message })
  // Persist the user turn before network work so an invoke rejection or crash cannot
  // silently discard what the user sent.
  saveSessionMessages(sessionId, messages)

  const endpoint = resolveEndpoint(provider, store)
  const headers = buildHeaders(provider, key)
  partialBySession.delete(sessionId)

  // 校验通过、流式开始前播种 start 事件，满足时序守卫（chunk 守卫通道需 start 先行；
  // 断线重连或连续消息会再次 start，状态机按"重新开始"合法转移）。
  pushWithGuard(event.sender, "chat-stream-start", { sessionId })

  try {
    if (mode === "ask") {
      await runAskMode(event, sessionId, provider, model, messages, endpoint, headers)
      return
    }
    await runAgentLoop(
      event,
      sessionId,
      provider,
      model,
      mode,
      workspace,
      messages,
      endpoint,
      headers,
    )
  } catch (err) {
    handleStreamFailure(event, sessionId, err)
  }
}
