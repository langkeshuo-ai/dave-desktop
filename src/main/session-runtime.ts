/* =========================================================================
   Per-session abort + approval gates (pure, testable, no Electron import).
   ========================================================================= */

export type ApprovalResolver = (approved: boolean) => void

export class SessionRuntime {
  private aborts = new Map<string, AbortController>()
  private approvals = new Map<string, ApprovalResolver>()

  /** Start a new abort scope for sessionId; aborts any previous in-flight fetch.
   *  如果上一轮 scope 已被中止(用户中途点"停止" / 上轮抛 AbortError 后未清),
   *  直接返回已中止 signal,fetch 会立即抛 AbortError — 不创建新 controller,
   *  避免 abort 状态被新 signal 覆盖、循环无法收敛。 */
  beginAbortScope(sessionId: string): AbortSignal {
    const prev = this.aborts.get(sessionId)
    if (prev) {
      if (prev.signal.aborted) {
        return prev.signal
      }
      prev.abort()
    }
    const controller = new AbortController()
    this.aborts.set(sessionId, controller)
    return controller.signal
  }

  getSignal(sessionId: string): AbortSignal | undefined {
    return this.aborts.get(sessionId)?.signal
  }

  clearAbort(sessionId: string): void {
    this.aborts.delete(sessionId)
  }

  /** Abort in-flight work and reject pending approval (as denied).
   *  保留 controller 在 Map 中(不清除),让 runToolCalls / runAgentLoop
   *  能查到 `getSignal(sessionId)?.aborted` 而跳过剩余工具。
   *  controller 会在 done/error 路径被 clearAbort 清理。 */
  abortSession(sessionId: string): void {
    const controller = this.aborts.get(sessionId)
    if (controller) {
      controller.abort()
      // Keep in map — runToolCalls checks signal.aborted to short-circuit
    }
    const pending = this.approvals.get(sessionId)
    if (pending) {
      this.approvals.delete(sessionId)
      pending(false)
    }
  }

  waitApproval(sessionId: string, timeoutMs = 5 * 60_000): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      // If a previous approval is still hanging, deny it first.
      const prev = this.approvals.get(sessionId)
      if (prev) {
        this.approvals.delete(sessionId)
        prev(false)
      }
      let settled = false
      const onTimeout = () => {
        if (settled) return
        settled = true
        this.approvals.delete(sessionId)
        resolve(false)
      }
      const timer = setTimeout(onTimeout, timeoutMs)
      this.approvals.set(sessionId, (approved: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.approvals.delete(sessionId)
        resolve(approved)
      })
    })
  }

  resolveApproval(sessionId: string, approved: boolean): boolean {
    const p = this.approvals.get(sessionId)
    if (!p) return false
    this.approvals.delete(sessionId)
    p(approved)
    return true
  }

  hasPendingApproval(sessionId: string): boolean {
    return this.approvals.has(sessionId)
  }

  hasActiveAbort(sessionId: string): boolean {
    return this.aborts.has(sessionId)
  }
}

/** Process-wide runtime used by chat-loop. */
export const sessionRuntime = new SessionRuntime()
