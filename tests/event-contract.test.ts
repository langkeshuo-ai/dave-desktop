/**
 * 事件契约闭环验证 — 单测
 *
 * 目标：在渲染端源码缺失（renderer 不可用）的前提下，仅靠 node 单测证明
 * 「主进程推送 → 事件时序 → 状态机 → 渲染输入文本」这条链路是闭环且可验证的。
 *
 * 约束：全程不使用 idempotentKey（其语义正在被改造），因此状态机「引用未变」
 * 的唯一来源就是非法转移，可被精确判为 violation，不会与幂等去重混淆。
 */
import { describe, it, expect } from "vitest"
import {
  runContractTrail,
  renderTranscript,
  type ContractTrailResult,
} from "../src/shared/event-contract"
import type { StreamEvent } from "../src/shared/chat-stream-state"

/** 主进程 6 类推送事件与 stream event 一一对应的最小会话 id */
const SID = "sess-1"

/** 构造一条完整合法链路（对应主进程推送时序） */
function fullLegalTrail(): StreamEvent[] {
  return [
    { type: "start", sessionId: SID },
    { type: "chunk", content: "你", sessionId: SID },
    { type: "chunk", content: "好", sessionId: SID },
    { type: "tools", sessionId: SID, tools: ["read"] },
    { type: "chunk", content: "，", sessionId: SID },
    {
      type: "approval",
      sessionId: SID,
      tool: "write",
      arguments: { path: "a.txt" },
      mutates: true,
      isShell: false,
    },
    { type: "approval_result", sessionId: SID, approved: true },
    { type: "chunk", content: "世界", sessionId: SID },
    { type: "done", sessionId: SID },
  ]
}

describe("event-contract 闭环验证", () => {
  // ─── (a) 完整合法序列 ──────────────────────────────

  it("完整合法序列：violations 为空、final 为 done、渲染文本还原为「你好，世界」", () => {
    const trail = runContractTrail(fullLegalTrail())

    expect(trail.violations).toEqual([])
    expect(trail.final.status).toBe("done")
    // 状态机时序正确累加了全部 chunk
    if (trail.final.status === "done") {
      expect(trail.final.finalContent).toBe("你好，世界")
    }
    expect(renderTranscript(trail)).toBe("你好，世界")
  })

  // ─── (b) 缺失 start 的非法序列 ─────────────────────

  it("任意的 chunk 若没有前置 start（idle 接收）应计入 violations", () => {
    const orphan: StreamEvent[] = [{ type: "chunk", content: "你", sessionId: SID }]
    const trail = runContractTrail(orphan)

    expect(trail.violations).toHaveLength(1)
    expect(trail.violations[0]).toMatchObject({ index: 0, event: orphan[0] })
    // idle 状态未被撬动，渲染文本为空
    expect(trail.final.status).toBe("idle")
    expect(renderTranscript(trail)).toBe("")
  })

  // ─── (c) done 之后的 chunk 非法 ────────────────────

  it("done 之后再来 chunk 应计入 violations，且 final 仍为 done", () => {
    const tail: StreamEvent[] = [
      ...fullLegalTrail(),
      { type: "chunk", content: "越界", sessionId: SID },
    ]
    const trail = runContractTrail(tail)

    expect(trail.violations).toHaveLength(1)
    expect(trail.violations[0].event.type).toBe("chunk")
    expect(trail.final.status).toBe("done")
    // 非法 chunk 不得污染已封存的 finalContent
    expect(renderTranscript(trail)).toBe("你好，世界")
  })

  // ─── (d) error 序列 ───────────────────────────────

  it("start→chunk→error 后 final 为 error，渲染文本返回 error 文案", () => {
    const trail = runContractTrail([
      { type: "start", sessionId: SID },
      { type: "chunk", content: "前文", sessionId: SID },
      { type: "error", error: "provider timeout", sessionId: SID },
    ])

    expect(trail.final.status).toBe("error")
    expect(renderTranscript(trail)).toBe("provider timeout")
  })

  // ─── (e) patch 独立载体语义（diff 不污染正文） ─────

  it("chunk 后 patch 不覆盖 content，正文保持并继续累加", () => {
    const trail = runContractTrail([
      { type: "start", sessionId: SID },
      { type: "chunk", content: "旧内容", sessionId: SID },
      { type: "patch", patch: "--- a/x\n+++ b/x", sessionId: SID },
      { type: "chunk", content: "续写", sessionId: SID },
    ])

    expect(trail.violations).toEqual([])
    expect(trail.final.status).toBe("streaming")
    if (trail.final.status === "streaming") {
      expect(trail.final.content).toBe("旧内容续写")
    }
    expect(renderTranscript(trail)).toBe("旧内容续写")
  })

  // ─── (f) reset 后从 idle 重来 ─────────────────────

  it("reset 回到 idle，再 start 后重新累计（旧 content 被清空）", () => {
    const trail = runContractTrail([
      { type: "start", sessionId: SID },
      { type: "chunk", content: "旧会话", sessionId: SID },
      { type: "reset" },
      { type: "start", sessionId: SID },
      { type: "chunk", content: "新会话", sessionId: SID },
    ])

    expect(trail.violations).toEqual([])
    expect(trail.final.status).toBe("streaming")
    if (trail.final.status === "streaming") {
      expect(trail.final.content).toBe("新会话")
    }
    expect(renderTranscript(trail)).toBe("新会话")
  })

  // 补充：返回类型可用性自证（类型即契约的一部分）
  it("返回结构携带可用的 violations 引用，便于上层直接消费", () => {
    const result: ContractTrailResult = runContractTrail([
      { type: "chunk", content: "你", sessionId: SID },
    ])
    expect(Array.isArray(result.violations)).toBe(true)
    expect(typeof result.final.status).toBe("string")
  })
})