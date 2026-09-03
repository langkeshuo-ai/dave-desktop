/**
 * Multi-Agent Collaboration Types — 多 Agent 协作类型定义
 *
 * 核心概念：
 * - AgentRole: Agent 角色（CEO 带队、Specialist 执行、Reviewer 审查）
 * - CollaborationStage: 协作阶段（组队→计划→执行→审查→完成）
 * - Checkpoint: 决策检查点（可回看的关键决策）
 * - CanvasNode/CanvasEdge: 协作画布节点与连线
 */

// ─── Agent 角色 ────────────────────────────────────────────

export type AgentRole = "ceo" | "specialist" | "reviewer" | "coder" | "researcher" | "writer"

export interface AgentDefinition {
  id: string
  name: string
  role: AgentRole
  description: string
  /** 系统提示词模板，{goal} 和 {context} 会被替换 */
  systemPrompt: string
  /** 该 Agent 可使用的工具名列表，空表示全部可用 */
  allowedTools?: string[]
  /** 头像颜色（CSS 变量名或 hex） */
  color: string
  /** 头像图标（lucide-react icon name） */
  icon: string
}

// ─── 协作阶段 ──────────────────────────────────────────────

export type CollaborationStage =
  | "idle" // 空闲，等待目标
  | "team_formation" // 组队：CEO 分析目标，选择 Specialist
  | "planning" // 计划：CEO 制定计划，分配任务
  | "execution" // 执行：Specialist 并行/串行执行任务
  | "review" // 审查：Reviewer 审查结果，CEO 汇总
  | "completed" // 完成

export interface StageInfo {
  stage: CollaborationStage
  label: string
  description: string
  startedAt: number
  completedAt?: number
}

// ─── 检查点 ────────────────────────────────────────────────

export type CheckpointType =
  | "goal_set" // 目标设定
  | "team_formed" // 组队完成
  | "plan_approved" // 计划批准
  | "task_started" // 任务开始
  | "task_completed" // 任务完成
  | "review_passed" // 审查通过
  | "review_failed" // 审查不通过
  | "decision_required" // 需要用户决策
  | "completed" // 完成

export interface Checkpoint {
  id: string
  type: CheckpointType
  stage: CollaborationStage
  agentId: string
  title: string
  description?: string
  /** 决策内容（如果是决策检查点） */
  decision?: string
  /** 用户是否已批准（如果需要用户决策） */
  approved?: boolean
  timestamp: number
}

// ─── 协作消息 ──────────────────────────────────────────────

export type MessageType =
  | "task_assignment" // CEO 分配任务
  | "task_result" // Specialist 返回结果
  | "review_feedback" // Reviewer 审查反馈
  | "ceo_synthesis" // CEO 汇总
  | "user_decision" // 用户决策
  | "status_update" // 状态更新

export interface CollaborationMessage {
  id: string
  type: MessageType
  fromAgentId: string
  toAgentId?: string // undefined 表示广播
  stage: CollaborationStage
  content: string
  /** 关联的任务 ID */
  taskId?: string
  timestamp: number
}

// ─── 任务 ──────────────────────────────────────────────────

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "needs_review"

export interface CollaborationTask {
  id: string
  title: string
  description: string
  assignedAgentId: string
  status: TaskStatus
  /** 任务结果（完成后） */
  result?: string
  /** 审查反馈 */
  review?: string
  /** 依赖的任务 ID 列表 */
  dependsOn?: string[]
  createdAt: number
  startedAt?: number
  completedAt?: number
}

// ─── 协作画布 ──────────────────────────────────────────────

export type CanvasNodeType = "agent" | "task" | "checkpoint" | "note" | "artifact"

export interface CanvasNode {
  id: string
  type: CanvasNodeType
  /** 关联的 Agent/任务/检查点 ID */
  refId?: string
  title: string
  subtitle?: string
  /** 画布坐标 */
  x: number
  y: number
  width: number
  height: number
  color?: string
  /** 节点状态（用于视觉区分） */
  status?: "idle" | "active" | "completed" | "error"
}

export interface CanvasEdge {
  id: string
  fromNodeId: string
  toNodeId: string
  /** 连线标签 */
  label?: string
  /** 连线类型 */
  type?: "flow" | "dependency" | "communication"
}

export interface CollaborationCanvas {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

// ─── 协作状态（完整状态） ──────────────────────────────────

export interface CollaborationState {
  sessionId: string
  goal: string
  stage: CollaborationStage
  stageHistory: StageInfo[]
  agents: AgentDefinition[]
  tasks: CollaborationTask[]
  checkpoints: Checkpoint[]
  messages: CollaborationMessage[]
  canvas: CollaborationCanvas
  /** 当前活跃的 Agent ID */
  activeAgentId?: string
  /** 是否需要用户决策 */
  pendingDecision?: {
    checkpointId: string
    question: string
    options: string[]
  }
  /** 最终产物 */
  finalResult?: string
  startedAt: number
  completedAt?: number
}

// ─── IPC 事件（渲染端监听） ────────────────────────────────

export interface MultiAgentStageEvent {
  sessionId: string
  stage: CollaborationStage
  stageInfo: StageInfo
}

export interface MultiAgentCheckpointEvent {
  sessionId: string
  checkpoint: Checkpoint
}

export interface MultiAgentMessageEvent {
  sessionId: string
  message: CollaborationMessage
}

export interface MultiAgentTaskEvent {
  sessionId: string
  task: CollaborationTask
}

export interface MultiAgentCanvasEvent {
  sessionId: string
  canvas: CollaborationCanvas
}

export interface MultiAgentDecisionEvent {
  sessionId: string
  checkpoint: Checkpoint
  question: string
  options: string[]
}

export interface MultiAgentCompleteEvent {
  sessionId: string
  result: string
  checkpoints: Checkpoint[]
}
