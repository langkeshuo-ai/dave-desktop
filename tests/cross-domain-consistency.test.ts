/**
 * 跨域一致性门禁测试
 *
 * 验证渲染进程、主进程 sessionRuntime、存储层之间的状态对齐。
 * 防止"删除 session 后 sessionRuntime 残留 abort/approval"等漂移问题。
 *
 * 测试范围：
 * 1. sessionRuntime abort 生命周期：beginAbortScope → clearAbort → 无残留
 * 2. sessionRuntime approval 生命周期：waitApproval → resolveApproval → 无残留
 * 3. abortSession 同时清理 abort + approval
 * 4. hasActiveAbort / hasPendingApproval 状态正确性
 * 5. deleteSession 后 sessionRuntime 无残留
 */
import { describe, it, expect, beforeEach } from "vitest"
import { SessionRuntime } from "../src/main/session-runtime"

describe("跨域一致性 — sessionRuntime 生命周期", () => {
  let runtime: SessionRuntime

  beforeEach(() => {
    runtime = new SessionRuntime()
  })

  // ─── 1. abort 生命周期 ─────────────────────────────

  it("beginAbortScope → clearAbort 后应无残留", () => {
    runtime.beginAbortScope("sess-1")
    expect(runtime.hasActiveAbort("sess-1")).toBe(true)

    runtime.clearAbort("sess-1")
    expect(runtime.hasActiveAbort("sess-1")).toBe(false)
  })

  it("重复 beginAbortScope 应中止前一个 scope", () => {
    const signal1 = runtime.beginAbortScope("sess-1")
    const signal2 = runtime.beginAbortScope("sess-1")

    expect(signal1.aborted).toBe(true)
    expect(signal2.aborted).toBe(false)
    expect(runtime.hasActiveAbort("sess-1")).toBe(true)
  })

  it("clearAbort 后不应影响其他 session", () => {
    runtime.beginAbortScope("sess-1")
    runtime.beginAbortScope("sess-2")
    runtime.clearAbort("sess-1")

    expect(runtime.hasActiveAbort("sess-1")).toBe(false)
    expect(runtime.hasActiveAbort("sess-2")).toBe(true)
  })

  // ─── 2. approval 生命周期 ──────────────────────────

  it("waitApproval → resolveApproval(true) 应返回 true 并清理", async () => {
    const promise = runtime.waitApproval("sess-1")
    expect(runtime.hasPendingApproval("sess-1")).toBe(true)

    runtime.resolveApproval("sess-1", true)
    const result = await promise

    expect(result).toBe(true)
    expect(runtime.hasPendingApproval("sess-1")).toBe(false)
  })

  it("waitApproval → resolveApproval(false) 应返回 false 并清理", async () => {
    const promise = runtime.waitApproval("sess-1")

    runtime.resolveApproval("sess-1", false)
    const result = await promise

    expect(result).toBe(false)
    expect(runtime.hasPendingApproval("sess-1")).toBe(false)
  })

  it("resolveApproval 对不存在的 session 应返回 false", () => {
    const result = runtime.resolveApproval("nonexistent", true)
    expect(result).toBe(false)
  })

  // ─── 3. abortSession 同时清理 abort + approval ───

  it("abortSession 应中止 abort 并拒绝 pending approval", async () => {
    runtime.beginAbortScope("sess-1")
    const approvalPromise = runtime.waitApproval("sess-1")

    expect(runtime.hasActiveAbort("sess-1")).toBe(true)
    expect(runtime.hasPendingApproval("sess-1")).toBe(true)

    runtime.abortSession("sess-1")

    // abort 应保持 active（controller 留在 map 中供 runToolCalls 检查）
    expect(runtime.hasActiveAbort("sess-1")).toBe(true)
    // signal 应已中止
    expect(runtime.getSignal("sess-1")?.aborted).toBe(true)
    // approval 应已清理
    expect(runtime.hasPendingApproval("sess-1")).toBe(false)

    // approval promise 应 resolve 为 false
    const approved = await approvalPromise
    expect(approved).toBe(false)
  })

  // ─── 4. waitApproval 超时清理 ─────────────────────

  it("waitApproval 超时应自动清理并 resolve false", async () => {
    const promise = runtime.waitApproval("sess-1", 10) // 10ms 超时
    expect(runtime.hasPendingApproval("sess-1")).toBe(true)

    // 等待超时
    const result = await promise

    expect(result).toBe(false)
    expect(runtime.hasPendingApproval("sess-1")).toBe(false)
  })

  // ─── 5. 多个 session 独立管理 ─────────────────────

  it("多个 session 的 abort 和 approval 应互不干扰", () => {
    runtime.beginAbortScope("sess-1")
    runtime.beginAbortScope("sess-2")
    runtime.waitApproval("sess-2")

    expect(runtime.hasActiveAbort("sess-1")).toBe(true)
    expect(runtime.hasActiveAbort("sess-2")).toBe(true)
    expect(runtime.hasPendingApproval("sess-2")).toBe(true)
    expect(runtime.hasPendingApproval("sess-1")).toBe(false)

    // 清理 sess-1 不应影响 sess-2
    runtime.clearAbort("sess-1")
    expect(runtime.hasActiveAbort("sess-1")).toBe(false)
    expect(runtime.hasActiveAbort("sess-2")).toBe(true)
    expect(runtime.hasPendingApproval("sess-2")).toBe(true)
  })

  // ─── 6. 完整生命周期：begin → wait → resolve → 无残留 ──

  it("完整生命周期后应无残留状态", async () => {
    runtime.beginAbortScope("sess-1")
    const promise = runtime.waitApproval("sess-1")

    runtime.resolveApproval("sess-1", true)
    await promise
    runtime.clearAbort("sess-1")

    expect(runtime.hasActiveAbort("sess-1")).toBe(false)
    expect(runtime.hasPendingApproval("sess-1")).toBe(false)
    // getSignal 对已不存在 session 应返回 undefined
    expect(runtime.getSignal("sess-1")).toBeUndefined()
  })

  // ─── 7. 重复 waitApproval 会拒绝前一个 ────────────

  it("重复 waitApproval 应拒绝前一个 pending approval", async () => {
    const promise1 = runtime.waitApproval("sess-1")
    const promise2 = runtime.waitApproval("sess-1") // 这一覆盖了 promise1

    // promise1 应被拒绝（resolve false）
    const result1 = await promise1
    expect(result1).toBe(false)

    runtime.resolveApproval("sess-1", true)
    const result2 = await promise2
    expect(result2).toBe(true)
  })
})

describe("跨域一致性 — 模拟 deleteSession 场景", () => {
  let runtime: SessionRuntime

  beforeEach(() => {
    runtime = new SessionRuntime()
  })

  it("deleteSession 等效场景：abortSession 后 clearAbort 应无残留", () => {
    // deleteSession 内部调用 sessionRuntime.abortSession(sessionId)
    // 模拟一个正在 streaming 的 session 被删除
    runtime.beginAbortScope("sess-1")
    runtime.waitApproval("sess-1")

    // 模拟 deleteSession 逻辑
    runtime.abortSession("sess-1")

    // 在 done/error 路径中会被 clearAbort
    runtime.clearAbort("sess-1")

    expect(runtime.hasActiveAbort("sess-1")).toBe(false)
    expect(runtime.hasPendingApproval("sess-1")).toBe(false)
    expect(runtime.getSignal("sess-1")).toBeUndefined()
  })

  it("abortSession 后不应残留 resolvable approval", () => {
    runtime.beginAbortScope("sess-1")
    runtime.waitApproval("sess-1")

    runtime.abortSession("sess-1")

    // abortSession 已清理 approval，resolve 应返回 false
    const resolved = runtime.resolveApproval("sess-1", true)
    expect(resolved).toBe(false)
  })
})