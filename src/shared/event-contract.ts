/**
 * 事件契约闭环验证 — 纯函数契约检查器
 *
 * 目标：在渲染端源码缺失的情况下，仍能在 node 单测中证明
 * 「主进程推送 → 事件时序 → 状态机 → 渲染输入文本」这条链路是闭环且可验证的。
 *
 * 设计原则：
 * 1. 复用 createChatStreamState() 状态机，把一整串 StreamEvent 依次喂给单个实例，
 *    由状态机守卫每个转移的合法性。
 * 2. violations 判定：对每个事件做「转移前状态引用 vs 转移后状态引用」对比，
 *    引用未变即表示状态机拒绝该事件（非法转移或处于终态）。
 * 3. 本模块刻意不使用 idempotentKey（其语义正在被改造），因此「引用未变」
 *    的唯一来源就是非法转移，不会把幂等去重误判为 violation。
 *
 * 无副作用、无 Electron 依赖，可在 vitest node 环境单测。
 */
import { createChatStreamState, type StreamEvent, type StreamStateStatus } from "./chat-stream-state"

// ─── 契约结果类型 ─────────────────────────────────────

/** 单条非法事件记录：事件在输入序列中的下标与事件本体 */
export interface ContractViolation {
  index: number
  event: StreamEvent
}

/** 契约链路运行结果 */
export interface ContractTrailResult {
  /** 喂完整个序列后的最终状态 */
  final: StreamStateStatus
  /** 被状态机拒绝（导致状态未变化）的事件；空数组表示链路完全合法 */
  violations: ContractViolation[]
}

// ─── 主入口 ───────────────────────────────────────────

/**
 * 把事件序列依次喂给单个状态机实例，返回最终状态与非法事件清单。
 *
 * 理论上一条链路应只对应一个会话状态机；violations 即该链路中
 * 时序非法、不应当被上层消费的事件。
 */
export function runContractTrail(events: StreamEvent[]): ContractTrailResult {
  const machine = createChatStreamState()
  const violations: ContractViolation[] = []

  for (let index = 0; index < events.length; index++) {
    const before = machine.getState()
    machine.transition(events[index])
    const after = machine.getState()

    // 引用相等表示状态机未接受该事件（非法转移 / 终态拒绝）。
    // 由于不使用 idempotentKey，此处不会出现「幂等去重导致的未变化」。
    if (after === before) {
      violations.push({ index, event: events[index] })
    }
  }

  return { final: machine.getState(), violations }
}

// ─── 渲染端文本还原 ───────────────────────────────────

/**
 * 从链路结果还原「渲染端可见文本」：
 *   streaming        → content
 *   done             → finalContent
 *   tool_pending     → content（工具执行间隙，保留已生成文本）
 *   approval_pending → content（等待审批间隙，保留已生成文本）
 *   error            → error 文案
 *   idle             → ""
 */
export function renderTranscript(trail: ContractTrailResult): string {
  switch (trail.final.status) {
    case "streaming":
      return trail.final.content
    case "done":
      return trail.final.finalContent
    case "tool_pending":
      return trail.final.content
    case "approval_pending":
      return trail.final.content
    case "error":
      return trail.final.error
    case "idle":
      return ""
  }
}