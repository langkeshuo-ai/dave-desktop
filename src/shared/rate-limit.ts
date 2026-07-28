/**
 * 简易滑动窗口限流器 — 主进程敏感 IPC 防刷。
 * 纯函数模块，无 Electron 依赖，可在 vitest 中单测。
 */

export type RateLimiter = {
  /** 当前窗口是否允许一次调用；允许时会计入窗口 */
  allow: () => boolean
  /** 当前窗口内已用次数 */
  used: () => number
  /** 清空窗口（测试 / 重置） */
  reset: () => void
}

export type RateLimiterOptions = {
  /** 窗口内最大调用次数 */
  max: number
  /** 窗口长度（毫秒） */
  windowMs: number
  /** 可选时钟，便于测试注入 */
  now?: () => number
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const max = Math.max(1, Math.floor(opts.max))
  const windowMs = Math.max(1, Math.floor(opts.windowMs))
  const now = opts.now ?? (() => Date.now())
  const hits: number[] = []

  const prune = (t: number) => {
    while (hits.length > 0 && (hits[0] ?? 0) <= t - windowMs) hits.shift()
  }

  return {
    allow() {
      const t = now()
      prune(t)
      if (hits.length >= max) return false
      hits.push(t)
      return true
    },
    used() {
      prune(now())
      return hits.length
    },
    reset() {
      hits.length = 0
    },
  }
}

/** 预置：敏感写操作（store-set / chat-stream / apply-patch 等） */
export const SENSITIVE_IPC_LIMIT = { max: 30, windowMs: 1000 } as const

/** 预置：高频但廉价读操作（可选） */
export const READ_IPC_LIMIT = { max: 120, windowMs: 1000 } as const
