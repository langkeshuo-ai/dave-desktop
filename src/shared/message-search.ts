/**
 * 会话内消息全文搜索 / assistant 导航 — 纯函数，零依赖。
 * 不引入 Fuse.js：聊天场景以精确子串为主，避免额外 bundle。
 */

export type SearchableMessage = {
  role: string
  content: string
}

export function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase()
}

export function messageMatchesQuery(content: string, normalizedQuery: string): boolean {
  if (!normalizedQuery) return false
  return (content || "").toLowerCase().includes(normalizedQuery)
}

/** 返回匹配消息的下标（升序）。空查询 → []。 */
export function findMessageMatchIndices(
  messages: readonly SearchableMessage[],
  rawQuery: string,
): number[] {
  const q = normalizeSearchQuery(rawQuery)
  if (!q) return []
  const hits: number[] = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (!m) continue
    if (messageMatchesQuery(m.content, q)) hits.push(i)
  }
  return hits
}

/**
 * 在 matches 环形列表中移动。
 * @param matches 升序匹配下标
 * @param current 当前激活的消息下标（未必在 matches 中）
 * @param delta +1 下一处 / -1 上一处
 */
export function stepMatchIndex(
  matches: readonly number[],
  current: number | null,
  delta: 1 | -1,
): number | null {
  if (matches.length === 0) return null
  if (current == null || !matches.includes(current)) {
    return delta === 1 ? (matches[0] ?? null) : (matches[matches.length - 1] ?? null)
  }
  const pos = matches.indexOf(current)
  const next = (pos + delta + matches.length) % matches.length
  return matches[next] ?? null
}

/** 从 fromIndex 起找相邻 assistant 消息（不含 fromIndex 自身）。 */
export function findAdjacentAssistantIndex(
  messages: readonly SearchableMessage[],
  fromIndex: number,
  direction: -1 | 1,
): number | null {
  if (messages.length === 0) return null
  let i = fromIndex
  if (!Number.isFinite(i)) i = direction === 1 ? -1 : messages.length
  i += direction
  while (i >= 0 && i < messages.length) {
    if (messages[i]?.role === "assistant") return i
    i += direction
  }
  return null
}
