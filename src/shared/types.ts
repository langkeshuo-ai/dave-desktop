/* =========================================================================
   Shared types — single source of truth for ChatMessage, Session, stream events.
   Imported by main, preload, and renderer.
   ========================================================================= */

export type AgentMode = "ask" | "suggest" | "auto" | "full-auto"
export type MessageRole = "user" | "assistant" | "system" | "tool"

export interface ToolCall {
  id: string
  type?: string
  function: { name: string; arguments: string }
}

export interface ChatMessage {
  role: MessageRole
  content: string
  /** OpenAI-style tool_calls — present when assistant requests tools. */
  tool_calls?: ToolCall[]
  /** Tool role messages carry tool_call_id to pair with the request. */
  tool_call_id?: string
  /** Tool name for role="tool" messages. */
  name?: string
}

export interface Session {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

export interface SessionData {
  session: Session | null
  messages: ChatMessage[]
}

export interface FilePickerResult {
  path: string
  name: string
  size: number
}

export interface ChatStreamChunk {
  content: string
  sessionId: string
  /** When true, content is a full reset (not a delta). Rare; default is delta append. */
  replace?: boolean
}

export interface ChatStreamDone {
  sessionId: string
  /** True when the stream was aborted (user stop / iteration cap / tool loop bail).
   *  Renderer 应保留 streamingContent 作为最后一条 assistant 消息,避免用户丢失部分输出。 */
  aborted?: boolean
}

export interface ChatStreamError {
  error: string
  sessionId: string
}

export interface ChatStreamApproval {
  sessionId: string
  tool: string
  arguments: Record<string, unknown>
  mutates: boolean
  isShell: boolean
}

export interface ChatStreamPatch {
  sessionId: string
  patch: string
  paths?: string[]
}

/** Live breadcrumb while the agent is executing tools this round. */
export interface ChatStreamTools {
  sessionId: string
  tools: string[]
}

/** Soft context budget (tokens) before truncating older messages. */
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 96_000
export const MAX_TOOL_OUTPUT_CHARS = 80_000
export const MAX_READ_FILE_CHARS = 200_000
