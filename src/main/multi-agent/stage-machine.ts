/**
 * Stage State Machine — 协作阶段状态机
 *
 * 阶段流转：idle → team_formation → planning → execution → review → completed
 * 每个阶段有进入/退出回调，阶段变更时通知渲染端。
 */
import type { CollaborationStage, StageInfo } from "./types"

// ─── 阶段元数据 ────────────────────────────────────────────

export const STAGE_META: Record<
  CollaborationStage,
  { label: string; description: string; order: number }
> = {
  idle: { label: "空闲", description: "等待目标输入", order: 0 },
  team_formation: { label: "组队", description: "CEO 分析目标，选择 Specialist", order: 1 },
  planning: { label: "计划", description: "制定执行计划，分解任务", order: 2 },
  execution: { label: "执行", description: "Specialist 执行分配的任务", order: 3 },
  review: { label: "审查", description: "审查结果，汇总产物", order: 4 },
  completed: { label: "完成", description: "协作完成，交付产物", order: 5 },
}

// ─── 合法流转 ──────────────────────────────────────────────

const VALID_TRANSITIONS: Record<CollaborationStage, CollaborationStage[]> = {
  idle: ["team_formation"],
  team_formation: ["planning", "idle"],
  planning: ["execution", "team_formation", "idle"],
  execution: ["review", "planning", "idle"],
  review: ["completed", "execution", "planning", "idle"],
  completed: ["idle"],
}

export function canTransition(from: CollaborationStage, to: CollaborationStage): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

// ─── 阶段状态机 ────────────────────────────────────────────

export class StageMachine {
  private current: CollaborationStage = "idle"
  private history: StageInfo[] = []
  private listeners: Set<(stage: CollaborationStage, info: StageInfo) => void> = new Set()

  get stage(): CollaborationStage {
    return this.current
  }

  get stageHistory(): StageInfo[] {
    return [...this.history]
  }

  get currentStageInfo(): StageInfo | undefined {
    return this.history[this.history.length - 1]
  }

  onStageChange(listener: (stage: CollaborationStage, info: StageInfo) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  transition(to: CollaborationStage): StageInfo | null {
    if (!canTransition(this.current, to)) {
      return null
    }

    // 完成当前阶段
    const currentInfo = this.history[this.history.length - 1]
    if (currentInfo && !currentInfo.completedAt) {
      currentInfo.completedAt = Date.now()
    }

    // 开始新阶段
    const meta = STAGE_META[to]
    const info: StageInfo = {
      stage: to,
      label: meta.label,
      description: meta.description,
      startedAt: Date.now(),
    }
    this.history.push(info)
    this.current = to

    // 通知监听者
    this.listeners.forEach((listener) => listener(to, info))

    return info
  }

  reset(): void {
    this.current = "idle"
    this.history = []
  }

  /** 获取阶段进度百分比（0-100） */
  get progress(): number {
    const meta = STAGE_META[this.current]
    const total = Object.keys(STAGE_META).length - 1 // 排除 idle
    return Math.round((meta.order / total) * 100)
  }
}
