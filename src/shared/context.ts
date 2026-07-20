/* =========================================================================
   Context window helpers — token estimate + truncation.
   Uses js-tiktoken (MIT) cl100k_base as a portable OpenAI/Anthropic-ish estimate.
   ========================================================================= */

import { getEncoding } from "js-tiktoken"
import type { ChatMessage } from "./types"
import { DEFAULT_CONTEXT_TOKEN_BUDGET, MAX_TOOL_OUTPUT_CHARS } from "./types"

let encoder: ReturnType<typeof getEncoding> | null = null

function enc() {
  if (!encoder) encoder = getEncoding("cl100k_base")
  return encoder
}

export function estimateTokens(text: string): number {
  if (!text) return 0
  try {
    return enc().encode(text).length
  } catch {
    // Fallback: ~4 chars per token
    return Math.ceil(text.length / 4)
  }
}

/** UI-only estimate — no tiktoken load (keeps renderer bundle small). */
export function estimateTokensRough(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

export function estimateMessageTokensRough(m: ChatMessage): number {
  let n = estimateTokensRough(m.content || "") + 4
  if (m.tool_calls) {
    for (const tc of m.tool_calls) {
      n +=
        estimateTokensRough(tc.function.name) +
        estimateTokensRough(tc.function.arguments || "") +
        8
    }
  }
  if (m.name) n += estimateTokensRough(m.name)
  return n
}

export function estimateMessageTokens(m: ChatMessage): number {
  let n = estimateTokens(m.content || "") + 4
  if (m.tool_calls) {
    for (const tc of m.tool_calls) {
      n += estimateTokens(tc.function.name) + estimateTokens(tc.function.arguments || "") + 8
    }
  }
  if (m.name) n += estimateTokens(m.name)
  return n
}

/** Cap huge tool outputs before they re-enter the model context. */
export function clampToolOutput(output: string, max = MAX_TOOL_OUTPUT_CHARS): string {
  if (output.length <= max) return output
  const head = Math.floor(max * 0.7)
  const tail = max - head - 80
  return `${output.slice(0, head)}\n\n…[截断 ${output.length - max} 字符]…\n\n${output.slice(-tail)}`
}

/**
 * Keep system messages + newest turns under budget.
 * Never drops the latest user message.
 */
export function truncateMessages(
  messages: ChatMessage[],
  budget = DEFAULT_CONTEXT_TOKEN_BUDGET,
): ChatMessage[] {
  if (messages.length === 0) return messages
  const systems = messages.filter((m) => m.role === "system")
  const rest = messages.filter((m) => m.role !== "system")
  let used = systems.reduce((s, m) => s + estimateMessageTokens(m), 0)
  const kept: ChatMessage[] = []
  for (let i = rest.length - 1; i >= 0; i--) {
    const cost = estimateMessageTokens(rest[i])
    if (kept.length > 0 && used + cost > budget) break
    kept.push(rest[i])
    used += cost
  }
  kept.reverse()
  // Ensure at least the last message survives even if over budget alone.
  if (kept.length === 0 && rest.length > 0) kept.push(rest[rest.length - 1])
  return [...systems, ...kept]
}
