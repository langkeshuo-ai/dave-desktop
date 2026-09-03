/* =========================================================================
   Session list + message persistence (electron-store backed).
   ========================================================================= */

import { ulid } from "ulid"
import { getStore } from "./store"
import { sessionRuntime } from "./session-runtime"
import type { ChatMessage, Session } from "../shared/types"
import log from "electron-log"

const BACKUP_PREFIX = "corrupt-backup-"
const BACKUP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000 // 30 days
const BACKUP_MAX_COUNT = 10

/** 删除超过 30 天的旧备份,每次新建前检查总数,超过 BACKUP_MAX_COUNT 则删最旧的。 */
export function pruneOldBackups(): void {
  try {
    const store = getStore()
    const now = Date.now()
    const keys: { key: string; ts: number }[] = []
    for (const k of Object.keys(store.store)) {
      if (!k.startsWith(BACKUP_PREFIX)) continue
      const ts = Number(k.split("-").pop() || "0")
      if (Number.isFinite(ts) && now - ts > BACKUP_MAX_AGE_MS) {
        store.delete(k)
      } else {
        keys.push({ key: k, ts })
      }
    }
    // 仍然超过上限,删最旧的
    if (keys.length >= BACKUP_MAX_COUNT) {
      keys.sort((a, b) => a.ts - b.ts)
      for (let i = 0; i < keys.length - BACKUP_MAX_COUNT + 1; i++) {
        store.delete(keys[i].key)
      }
    }
  } catch {
    // best-effort cleanup; 不打断主流程
  }
}

function recoverCorruptJson(key: string, raw: string, error: unknown): void {
  const backupKey = `${BACKUP_PREFIX}${key}-${Date.now()}`
  const store = getStore()
  pruneOldBackups()
  store.set(backupKey, raw)
  store.delete(key)
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

/**
 * 整表替换会话消息（编辑/再生成截断用）。
 * 调用方需已 abort 该 session 的 inflight 流。
 */
export function replaceSessionMessages(sessionId: string, messages: ChatMessage[]): boolean {
  const list = getSessionList()
  if (!list.some((s) => s.id === sessionId)) return false
  saveSessionMessages(sessionId, messages)
  const session = list.find((s) => s.id === sessionId)
  if (session) {
    session.updatedAt = Date.now()
    saveSessionList(list)
  }
  return true
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
