/* =========================================================================
   Multi-provider request/response adapters (OpenAI-compatible + Anthropic).
   ========================================================================= */

import type { ChatMessage, ToolCall } from "../shared/types"
import type { getStore } from "./store"

type Store = ReturnType<typeof getStore>

export function isAnthropic(provider: string): boolean {
  return provider === "anthropic"
}

export function resolveEndpoint(provider: string, store: Store): string {
  if (provider === "anthropic") return "https://api.anthropic.com/v1/messages"
  const base =
    provider === "deepseek"
      ? "https://api.deepseek.com/v1"
      : provider === "custom"
        ? (store.get("custom-host") as string) || "https://api.openai.com/v1"
        : "https://api.openai.com/v1"
  return `${base.replace(/\/$/, "")}/chat/completions`
}

export function resolveKey(provider: string, store: Store, fallback: string): string {
  if (provider === "custom") {
    // Settings store primary as `${provider}-api-key` (for custom → custom-api-key)
    // and may also set explicit custom-api-key from the optional field.
    const a = ((store.get("custom-api-key") as string) || "").trim()
    const b = (fallback || "").trim()
    return a || b
  }
  return (fallback || "").trim()
}

export function resolveModel(provider: string, store: Store, fallback: string): string {
  if (provider === "deepseek") return fallback || "deepseek-chat"
  if (provider === "custom") return (store.get("custom-model") as string) || "gpt-4o"
  if (provider === "anthropic") return fallback || "claude-sonnet-4-20250514"
  return fallback || "gpt-4o"
}

export function buildHeaders(provider: string, key: string): Record<string, string> {
  if (isAnthropic(provider)) {
    return {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    }
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  }
}

function splitSystem(messages: ChatMessage[]): { system: string; convo: ChatMessage[] } {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n")
  const convo = messages.filter((m) => m.role !== "system")
  return { system, convo }
}

/** Streaming (no tools) body. */
export function buildStreamBody(provider: string, model: string, messages: ChatMessage[]): string {
  if (isAnthropic(provider)) {
    const { system, convo } = splitSystem(messages)
    return JSON.stringify({
      model,
      max_tokens: 4096,
      ...(system ? { system } : {}),
      messages: convo.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
      stream: true,
    })
  }
  return JSON.stringify({
    model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: true,
  })
}

/**
 * Convert OpenAI-shaped ChatMessage[] into Anthropic Messages API payload.
 * Internal storage stays OpenAI-shaped for simplicity.
 */
export function toAnthropicMessages(convo: ChatMessage[]): unknown[] {
  const out: unknown[] = []
  let i = 0
  while (i < convo.length) {
    const m = convo[i]
    if (m.role === "assistant") {
      const blocks: unknown[] = []
      if (m.content) blocks.push({ type: "text", text: m.content })
      if (m.tool_calls?.length) {
        for (const tc of m.tool_calls) {
          let input: unknown = {}
          try {
            input = JSON.parse(tc.function.arguments || "{}")
          } catch {
            input = { raw: tc.function.arguments }
          }
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input,
          })
        }
      }
      out.push({ role: "assistant", content: blocks.length ? blocks : m.content || "" })
      i++
      continue
    }
    if (m.role === "tool") {
      // Collapse consecutive tool results into one user message (Anthropic requirement).
      const results: unknown[] = []
      while (i < convo.length && convo[i].role === "tool") {
        const t = convo[i]
        results.push({
          type: "tool_result",
          tool_use_id: t.tool_call_id,
          content: t.content || "",
        })
        i++
      }
      out.push({ role: "user", content: results })
      continue
    }
    // user (and any other → user)
    out.push({ role: "user", content: m.content || "" })
    i++
  }
  return out
}

export function buildAgentBody(
  provider: string,
  model: string,
  messages: ChatMessage[],
  tools: Record<string, unknown>[],
): string {
  if (isAnthropic(provider)) {
    const { system, convo } = splitSystem(messages)
    return JSON.stringify({
      model,
      max_tokens: 4096,
      ...(system ? { system } : {}),
      messages: toAnthropicMessages(convo),
      ...(tools.length > 0
        ? {
            tools: tools.map((t) => {
              const fn = (
                t as { function: { name: string; description: string; parameters: unknown } }
              ).function
              return {
                name: fn.name,
                description: fn.description,
                input_schema: fn.parameters,
              }
            }),
          }
        : {}),
    })
  }
  return JSON.stringify({
    model,
    messages: messages.map((m) => {
      const out: Record<string, unknown> = { role: m.role, content: m.content }
      if (m.tool_calls) out.tool_calls = m.tool_calls
      if (m.tool_call_id) out.tool_call_id = m.tool_call_id
      if (m.name) out.name = m.name
      return out
    }),
    ...(tools.length > 0 ? { tools } : {}),
    stream: false,
  })
}

export type ProbeResult = {
  ok: boolean
  latencyMs: number
  message: string
}

/**
 * Minimal connectivity probe — no third-party SDK.
 * OpenAI-compatible: GET /models. Anthropic: tiny non-stream messages call.
 */
export async function probeProviderConnection(opts: {
  provider: string
  apiKey: string
  model?: string
  customHost?: string
  customModel?: string
  timeoutMs?: number
}): Promise<ProbeResult> {
  const provider = opts.provider || "openai"
  const key = (opts.apiKey || "").trim()
  if (!key) {
    return { ok: false, latencyMs: 0, message: "未填写 API Key" }
  }

  const timeoutMs = opts.timeoutMs ?? 12_000
  const started = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)

  try {
    if (provider === "anthropic") {
      const model = opts.model || "claude-sonnet-4-20250514"
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: buildHeaders(provider, key),
        body: JSON.stringify({
          model,
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        }),
        signal: ctrl.signal,
      })
      const latencyMs = Date.now() - started
      if (!res.ok) {
        const body = await res.text().catch(() => "")
        return {
          ok: false,
          latencyMs,
          message: `HTTP ${res.status}${body ? ` · ${body.slice(0, 120)}` : ""}`,
        }
      }
      return { ok: true, latencyMs, message: `已连通 · ${latencyMs}ms` }
    }

    const base =
      provider === "deepseek"
        ? "https://api.deepseek.com/v1"
        : provider === "custom"
          ? (opts.customHost || "https://api.openai.com/v1").replace(/\/$/, "")
          : "https://api.openai.com/v1"
    const res = await fetch(`${base}/models`, {
      method: "GET",
      headers: buildHeaders(provider, key),
      signal: ctrl.signal,
    })
    const latencyMs = Date.now() - started
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      return {
        ok: false,
        latencyMs,
        message: `HTTP ${res.status}${body ? ` · ${body.slice(0, 120)}` : ""}`,
      }
    }
    return { ok: true, latencyMs, message: `已连通 · ${latencyMs}ms` }
  } catch (err) {
    const latencyMs = Date.now() - started
    const name = err instanceof Error ? err.name : ""
    const msg = err instanceof Error ? err.message : String(err)
    if (name === "AbortError") {
      return { ok: false, latencyMs, message: `超时（>${timeoutMs}ms）` }
    }
    return { ok: false, latencyMs, message: msg || "网络错误" }
  } finally {
    clearTimeout(timer)
  }
}

export function extractDelta(provider: string, parsed: unknown): string {
  const p = parsed as Record<string, unknown>
  if (isAnthropic(provider)) {
    if (p?.type === "content_block_delta") {
      const delta = p.delta as { text?: string } | undefined
      return delta?.text || ""
    }
    return ""
  }
  const choices = p?.choices as Array<{ delta?: { content?: string } }> | undefined
  return choices?.[0]?.delta?.content || ""
}

/** OpenAI-style envelope → ChatMessage */
export function openAiToMessage(parsed: unknown): ChatMessage {
  const p = parsed as {
    choices?: Array<{ message?: { content?: string; tool_calls?: ToolCall[] } }>
  }
  const msg = p?.choices?.[0]?.message
  return {
    role: "assistant",
    content: msg?.content || "",
    tool_calls: msg?.tool_calls,
  }
}

/** Anthropic Messages response → ChatMessage (OpenAI-shaped tool_calls). */
export function anthropicToMessage(parsed: unknown): ChatMessage {
  const p = parsed as { content?: Array<Record<string, unknown>> }
  const blocks = p?.content ?? []
  const text = blocks
    .filter((b) => b.type === "text")
    .map((b) => String(b.text ?? ""))
    .join("")
  const toolUses = blocks.filter((b) => b.type === "tool_use")
  if (toolUses.length === 0) return { role: "assistant", content: text }
  return {
    role: "assistant",
    content: text,
    tool_calls: toolUses.map((b) => ({
      id: String(b.id),
      type: "function",
      function: {
        name: String(b.name),
        arguments: JSON.stringify(b.input ?? {}),
      },
    })),
  }
}
