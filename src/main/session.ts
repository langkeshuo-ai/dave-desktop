/* =========================================================================
   Session list + message persistence (electron-store backed).
   ========================================================================= */

import { ulid } from "ulid"
import { getStore } from "./store"
import { sessionRuntime } from "./session-runtime"
import type { ChatMessage, Session } from "../shared/types"
import log from "electron-log"

function recoverCorruptJson(key: string, raw: string, error: unknown): void {
  const backupKey = `corrupt-backup-${key}-${Date.now()}`
  getStore().set(backupKey, raw)
  getStore().delete(key)
  log.error(
    `session persistence: corrupt JSON moved to ${backupKey}:`,
    error instanceof Error ? error.message : String(error),
  )
}

export function getSessionList(): Session[] {
  const raw = getStore().get("session-list") as string | undefined
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) throw new Error("session-list must be an array")
    return parsed as Session[]
  } catch (error) {
    recoverCorruptJson("session-list", raw, error)
    return []
  }
}

export function saveSessionList(sessions: Session[]): void {
  getStore().set("session-list", JSON.stringify(sessions))
}

export function getSessionMessages(sessionId: string): ChatMessage[] {
  const raw = getStore().get(`session-messages-${sessionId}`) as string | undefined
  if (!raw) return []
  const key = `session-messages-${sessionId}`
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) throw new Error("session messages must be an array")
    return parsed as ChatMessage[]
  } catch (error) {
    recoverCorruptJson(key, raw, error)
    return []
  }
}

export function saveSessionMessages(sessionId: string, messages: ChatMessage[]): void {
  getStore().set(`session-messages-${sessionId}`, JSON.stringify(messages))
}

export function getSession(sessionId: string): {
  session: Session | null
  messages: ChatMessage[]
} {
  const session = getSessionList().find((s) => s.id === sessionId) ?? null
  return { session, messages: getSessionMessages(sessionId) }
}

export function createSession(): string {
  const id = `session_${ulid()}`
  const sessions = getSessionList()
  sessions.unshift({ id, title: "新会话", createdAt: Date.now(), updatedAt: Date.now() })
  saveSessionList(sessions)
  saveSessionMessages(id, [])
  return id
}

export function deleteSession(sessionId: string): void {
  // 终止该 session 在 sessionRuntime 中的 abort controller 与等待中的 approval,
  // 否则 Map 会无限增长,长生命周期下出现内存泄漏。
  // 渲染端的 chunk/done 事件有 sessionId 过滤,删除后即使发了也会被忽略,无 UX 影响。
  sessionRuntime.abortSession(sessionId)
  saveSessionList(getSessionList().filter((s) => s.id !== sessionId))
  getStore().delete(`session-messages-${sessionId}`)
}

export function updateSessionTitle(sessionId: string, title: string): void {
  const sessions = getSessionList()
  const session = sessions.find((s) => s.id === sessionId)
  if (!session) return
  session.title = title
  session.updatedAt = Date.now()
  saveSessionList(sessions)
}

export function autoTitleSession(sessionId: string, messages: ChatMessage[]): void {
  const sessions = getSessionList()
  const session = sessions.find((s) => s.id === sessionId)
  if (!session || session.title !== "新会话") return
  const firstUser = messages.find((m) => m.role === "user")
  if (!firstUser) return
  // Collapse whitespace; keep first line only so multi-line prompts stay readable.
  const oneLine = firstUser.content.replace(/\s+/g, " ").trim()
  session.title = oneLine.slice(0, 40) || "新会话"
  session.updatedAt = Date.now()
  saveSessionList(sessions)
}
