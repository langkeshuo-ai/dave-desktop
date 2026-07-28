/**
 * 流式 Markdown 节流决策 — 纯函数，便于单测。
 *
 * 流式时每个 token 都触发 ReactMarkdown 全量重解析成本极高；
 * 在流式阶段按间隔更新渲染内容，流结束立刻刷到最终值。
 */

export type ThrottleDecision = {
  /** 是否应立即采用最新 content 作为渲染值 */
  updateNow: boolean
  /** 若非立即更新，建议的延迟（ms） */
  delayMs: number
}

/**
 * @param isStreaming 当前是否在流式生成
 * @param elapsedSinceLastRenderMs 距上次实际渲染更新的毫秒数
 * @param intervalMs 流式阶段的最小渲染间隔（默认 120ms ≈ 8fps 解析足够流畅）
 */
export function shouldUpdateMarkdown(
  isStreaming: boolean,
  elapsedSinceLastRenderMs: number,
  intervalMs = 120,
): ThrottleDecision {
  const interval = Math.max(16, Math.floor(intervalMs))
  if (!isStreaming) {
    return { updateNow: true, delayMs: 0 }
  }
  if (elapsedSinceLastRenderMs >= interval) {
    return { updateNow: true, delayMs: 0 }
  }
  return { updateNow: false, delayMs: interval - elapsedSinceLastRenderMs }
}
