/* Session export helpers — pure, no I/O. */

import type { ChatMessage } from "./types"

/** Serialize transcript to Markdown (Codex/Cursor share style). */
export function messagesToMarkdown(
  messages: ChatMessage[],
  opts?: { title?: string; sessionId?: string },
): string {
  const lines: string[] = []
  const title = opts?.title?.trim() || "Dave session"
  lines.push(`# ${title}`)
  if (opts?.sessionId) lines.push("", `> id: \`${opts.sessionId}\``)
  lines.push("")

  for (const m of messages) {
    if (m.role === "system") continue
    if (m.role === "user") {
      lines.push("## User", "", m.content || "", "")
      continue
    }
    if (m.role === "assistant") {
      lines.push("## Assistant", "", m.content || "", "")
      if (m.tool_calls?.length) {
        lines.push(
          "",
          "_tools:_ " + m.tool_calls.map((t) => t.function.name).join(", "),
          "",
        )
      }
      continue
    }
    if (m.role === "tool") {
      const name = m.name || "tool"
      const body = (m.content || "").trim()
      lines.push(`### tool · ${name}`, "", "```", body.slice(0, 8000), "```", "")
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n"
}

/** Cursor-style path mention for the composer. */
export function formatPathMention(path: string): string {
  const p = path.replace(/\\/g, "/").replace(/^\.\//, "").trim()
  if (!p) return ""
  // Quote if spaces
  if (/\s/.test(p)) return `@"${p}"`
  return `@${p}`
}
