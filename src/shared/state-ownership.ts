/* =========================================================================
   State ownership contract — 状态所有权规约 (0.3.0 架构增量)

   ADHD 架构决议（2026-08-31）方案3的最小落地：
   "状态所有权分片"以 约定 + 守卫 + 门禁 方式落地，不引入新抽象层。

   三域归属（唯一 owner，跨域只读）：
   - 会话域（会话列表、消息、标题、编辑草稿）→ 渲染端 Zustand 拥有
   - 生命周期域（isActive/isStreaming/aborted/pendingApproval/AbortController）
     → 主进程 session-runtime 拥有
   - 编排域（当前会话 id / 模式 / provider / 审批决策）
     → 主进程 session / chat-loop 拥有

   规则：
   1. 任何可变状态只允许在其 owner 模块内变更。
   2. 跨域共享一律转只读事件流 / 自包含快照，禁止直接改写他域可变态。
   3. 新功能的每个状态字段必须先声明归属（走到下面哪个域）、合法变更入口
      （IPC 通道名或 store action）、只读订阅通道，才能合入。
   ========================================================================= */

/** 状态域（唯一 owner） */
export const StateScope = {
  Session: "session", // 渲染 Zustand — 会话列表/消息/标题/编辑草稿
  Lifecycle: "lifecycle", // 主进程 session-runtime — 流式/中止/审批进行中
  Orchestration: "orchestration", // 主进程 session/chat-loop — 当前会话/模式/provider
} as const

export type StateScope = (typeof StateScope)[keyof typeof StateScope]

/**
 * 单块跨域共享状态的所有权契约。
 * authority: 唯一权威进程(main|renderer)+模块，写入点必须在该模块内。
 * writeEntries: 合法的写入入口(IPC 通道名或 store action)——外部唯一路径。
 * readSubChannel: 只读订阅通道，跨域读共享状态走事件/快照，禁止直写。
 */
export interface StateOwnershipContract {
  /** 状态字段名 */
  field: string
  scope: StateScope
  /** 权威源: "main:<module>" 或 "renderer:<store>" */
  authority: string
  /** 允许的变更入口(仅这些 IPC 通道 / store action 可以改它) */
  writeEntries: readonly string[]
  /** 只读订阅通道(跨域读状态) */
  readSubChannel: string
}

/**
 * 跨三域的关键共享状态清单。
 * 新增状态字段时必须在此登记，否则违反所有权分片规约。
 */
export const STATE_OWNERSHIP: readonly StateOwnershipContract[] = [
  {
    field: "currentSessionId",
    scope: StateScope.Orchestration,
    authority: "main:session",
    writeEntries: [
      "session-create",
      "session-delete",
      "session-update-title",
      "chat-stream",
      "multi-agent:start",
    ],
    readSubChannel: "session-list",
  },
  {
    field: "isStreaming",
    scope: StateScope.Lifecycle,
    authority: "main:session-runtime",
    writeEntries: ["chat-stream", "chat-abort", "session-replace-messages"],
    readSubChannel: "chat-stream-chunk|chat-stream-done",
  },
  {
    field: "aborted",
    scope: StateScope.Lifecycle,
    authority: "main:session-runtime",
    writeEntries: ["chat-abort", "session-replace-messages"],
    readSubChannel: "chat-stream-done(aborted 字段)",
  },
  {
    field: "pendingApproval",
    scope: StateScope.Lifecycle,
    authority: "main:session-runtime",
    writeEntries: ["chat-approve"],
    readSubChannel: "chat-stream-approval",
  },
  {
    field: "messages",
    scope: StateScope.Session,
    authority: "renderer:useStore",
    writeEntries: ["session-get", "session-replace-messages"],
    readSubChannel: "session-get(replace 后回读)",
  },
]

/**
 * 校验:某个 IPC 通道是否是该字段的合法写入入口。
 * 纯函数,可在单测中直接断言。
 */
export function isLegitWriteEntry(field: string, channel: string): boolean {
  const contract = STATE_OWNERSHIP.find((c) => c.field === field)
  if (!contract) return false
  return contract.writeEntries.includes(channel)
}

/**
 * 校验:某状态字段的所有权是否已按规约登记。
 * 未登记即视为违反规约(孤儿状态)。
 */
export function isRegisteredState(field: string): boolean {
  return STATE_OWNERSHIP.some((c) => c.field === field)
}
