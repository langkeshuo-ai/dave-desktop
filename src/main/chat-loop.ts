/* =========================================================================
   Chat agent loop — streaming, tools, approval, abort.
   ========================================================================= */

import type { IpcMainInvokeEvent } from "electron"
import log from "electron-log"
import type { AgentMode, ChatMessage } from "../shared/types"
import { clampToolOutput, truncateMessages } from "../shared/context"
import {
  getTool,
  needsApproval,
  toolDefsFor,
  type ToolResult,
} from "./agent"
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
import {
  autoTitleSession,
  getSessionMessages,
  saveSessionMessages,
} from "./session"
import { sessionRuntime } from "./session-runtime"
import { getStore } from "./store"

export function resolveApproval(sessionId: string, approved: boolean): void {
  sessionRuntime.resolveApproval(sessionId, approved)
}

export function abortSession(sessionId: string): void {
  sessionRuntime.abortSession(sessionId)
}

function fetchWithAbort(sessionId: string, url: string, init: RequestInit): Promise<Response> {
  const signal = sessionRuntime.beginAbortScope(sessionId)
  return fetch(url, { ...init, signal })
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
  for (let i = 0; i < text.length; i += chunkSize) {
    if (sessionRuntime.getSignal(sessionId)?.aborted) break
    event.sender.send("chat-stream-chunk", {
      content: text.slice(i, i + chunkSize),
      sessionId,
    })
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
  const response = await fetchWithAbort(sessionId, endpoint, {
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
  let buffer = ""
  let full = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith("data: ")) continue
      const data = trimmed.slice(6)
      if (data === "[DONE]") continue
      try {
        const parsed = JSON.parse(data)
        const content = extractDelta(provider, parsed)
        if (content) {
          full += content
          event.sender.send("chat-stream-chunk", { content, sessionId })
        }
      } catch {
        /* partial */
      }
    }
  }
  return full
}

function getSessionWorkspace(): string {
  return (getStore().get("cwd") as string) || ""
}

function getSessionMode(): AgentMode {
  return (getStore().get("mode") as AgentMode) || "ask"
}

function finishOk(event: IpcMainInvokeEvent, sessionId: string): void {
  sessionRuntime.clearAbort(sessionId)
  event.sender.send("chat-stream-done", { sessionId })
}

function finishErr(event: IpcMainInvokeEvent, sessionId: string, error: string): void {
  sessionRuntime.clearAbort(sessionId)
  event.sender.send("chat-stream-error", { error, sessionId })
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
    event, sessionId, provider, endpoint, headers, buildStreamBody(provider, model, messages),
  )
  messages.push({ role: "assistant", content: full })
  saveSessionMessages(sessionId, messages)
  autoTitleSession(sessionId, messages)
  finishOk(event, sessionId)
}

/** 软上限 — 模型故障时循环兜底,避免烧 token / 内存。 */
const MAX_AGENT_ITERATIONS = 50

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
  const tools = toolDefsFor(provider)
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
    const resp = await fetchWithAbort(sessionId, endpoint, { method: "POST", headers, body })

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "unknown error")
      finishErr(event, sessionId, `API 错误 (${resp.status}): ${errBody}`)
      return
    }

    const parsed = await resp.json()
    const assistantMsg: ChatMessage = isAnthropic(provider)
      ? anthropicToMessage(parsed)
      : openAiToMessage(parsed)

    const hasToolCalls = !!(assistantMsg.tool_calls?.length)
    if (!hasToolCalls) {
      if (assistantMsg.content) {
        await emitLocalStream(event, sessionId, assistantMsg.content)
      } else {
        assistantMsg.content = await streamFromProvider(
          event, sessionId, provider, endpoint, headers,
          buildStreamBody(provider, model, [...messages, { role: "assistant", content: "" }]),
        )
      }
      messages.push(assistantMsg)
      saveSessionMessages(sessionId, messages)
      autoTitleSession(sessionId, messages)
      finishOk(event, sessionId)
      return
    }

    event.sender.send("chat-stream-tools", {
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
    const tool = getTool(tc.function.name)
    if (!tool) {
      messages.push({
        role: "tool", tool_call_id: tc.id, name: tc.function.name,
        content: `错误：未知工具 ${tc.function.name}`,
      })
      continue
    }
    let args: Record<string, unknown> = {}
    try { args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown> } catch { args = {} }

    if (needsApproval(tool, mode, args)) {
      event.sender.send("chat-stream-approval", {
        sessionId, tool: tool.name, arguments: args,
        mutates: tool.mutates, isShell: tool.isShell,
      })
      const approved = await sessionRuntime.waitApproval(sessionId)
      if (!approved) {
        messages.push({
          role: "tool", tool_call_id: tc.id, name: tool.name,
          content: "用户拒绝了此操作（或会话已中止）",
        })
        continue
      }
    }

    try {
      const result: ToolResult = await tool.run(workspace, args, mode)
      if (result.patch) {
        event.sender.send("chat-stream-patch", {
          sessionId, patch: result.patch, paths: result.paths,
        })
      }
      messages.push({
        role: "tool", tool_call_id: tc.id, name: tool.name,
        content: clampToolOutput(result.output),
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      messages.push({
        role: "tool", tool_call_id: tc.id, name: tool.name,
        content: `工具失败：${msg}`,
      })
    }
  }
}

export async function handleChatStream(
  event: IpcMainInvokeEvent,
  message: string,
  sessionId: string,
): Promise<void> {
  const store = getStore()
  const provider = (store.get("provider") as string) || "openai"
  const storedKey = ((store.get(`${provider}-api-key`) as string) || "").trim()
  const model = resolveModel(provider, store, (store.get(`${provider}-model`) as string) || "")
  // resolveKey handles custom-api-key alias; never ship empty Bearer headers.
  const key = resolveKey(provider, store, storedKey)
  if (!key) {
    event.sender.send("chat-stream-error", { error: "请先在设置中配置 API 密钥", sessionId })
    return
  }

  const mode = getSessionMode()
  // ask mode still streams without tools; workspace only required for agent modes.
  const workspace = mode === "ask" ? "" : getSessionWorkspace()
  if (mode !== "ask" && !workspace) {
    event.sender.send("chat-stream-error", {
      error: "工作区未配置 — 请在设置中选择工作区目录",
      sessionId,
    })
    return
  }

  const messages = truncateMessages(getSessionMessages(sessionId))
  messages.push({ role: "user", content: message })

  const endpoint = resolveEndpoint(provider, store)
  const headers = buildHeaders(provider, key)

  try {
    if (mode === "ask") {
      await runAskMode(event, sessionId, provider, model, messages, endpoint, headers)
      return
    }
    await runAgentLoop(event, sessionId, provider, model, mode, workspace, messages, endpoint, headers)
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      sessionRuntime.clearAbort(sessionId)
      // aborted=true 让渲染端把 streamingContent 落为最后一条 assistant 消息,
      // 否则用户中途点停止时正在打字的部分输出会被清空,体感丢消息。
      event.sender.send("chat-stream-done", { sessionId, aborted: true })
      return
    }
    if (err instanceof Error && (err.name === "AbortError" || /aborted/i.test(err.message))) {
      sessionRuntime.clearAbort(sessionId)
      event.sender.send("chat-stream-done", { sessionId, aborted: true })
      return
    }
    const msg = err instanceof Error ? err.message : String(err)
    log.error("chat-stream failure:", msg)
    finishErr(event, sessionId, msg)
  }
}
