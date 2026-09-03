/**
 * Multi-Agent Orchestrator — 多 Agent 协作编排引擎
 *
 * 核心流程：
 * 1. 接收用户目标 → 组队（CEO + Specialist）
 * 2. CEO 制定计划 → 分解任务
 * 3. Specialist 执行任务 → 返回结果
 * 4. Reviewer 审查 → CEO 汇总
 * 5. 完成 → 交付产物
 *
 * 与现有 chat-loop 集成：复用 LLM 调用基础设施，
 * 通过 IPC 事件通知渲染端更新 UI（阶段卡、画布、时间线）。
 */
import { ulid } from "ulid"
import type { BrowserWindow, IpcMainInvokeEvent } from "electron"
import log from "electron-log"
import { StageMachine } from "./stage-machine"
import { CEO_AGENT, selectSpecialistsForGoal, getAgentById } from "./agents"
import { saveCollaboration } from "./persistence"
import type {
  CollaborationState,
  CollaborationTask,
  Checkpoint,
  CollaborationMessage,
  CanvasNode,
  CanvasEdge,
  AgentDefinition,
} from "./types"

// ─── 协作会话管理 ──────────────────────────────────────────

const activeCollaborations = new Map<string, CollaborationSession>()

export function getCollaboration(sessionId: string): CollaborationSession | undefined {
  return activeCollaborations.get(sessionId)
}

export function getAllCollaborations(): CollaborationSession[] {
  return [...activeCollaborations.values()]
}

// ─── 协作会话 ──────────────────────────────────────────────

export class CollaborationSession {
  readonly sessionId: string
  private state: CollaborationState
  private stageMachine: StageMachine
  private window: BrowserWindow | null = null
  private aborted = false
  private decisionResolver: ((approved: boolean, note?: string) => void) | null = null

  constructor(sessionId: string, goal: string) {
    this.sessionId = sessionId
    this.stageMachine = new StageMachine()
    this.state = {
      sessionId,
      goal,
      stage: "idle",
      stageHistory: [],
      agents: [CEO_AGENT],
      tasks: [],
      checkpoints: [],
      messages: [],
      canvas: { nodes: [], edges: [] },
      startedAt: Date.now(),
    }
    activeCollaborations.set(sessionId, this)
  }

  setWindow(win: BrowserWindow | null): void {
    this.window = win
  }

  getState(): CollaborationState {
    return { ...this.state }
  }

  abort(): void {
    this.aborted = true
    // 如果有等待中的决策，拒绝它
    if (this.decisionResolver) {
      this.decisionResolver(false, "aborted")
      this.decisionResolver = null
    }
  }

  // ─── 用户决策关口 ────────────────────────────────────────

  /**
   * 请求用户决策，阻塞直到用户响应。
   * 发射 multi-agent:decision-request 事件，渲染端显示决策弹窗。
   */
  private requestDecision(opts: {
    checkpointType: "decision_required"
    stage: CollaborationState["stage"]
    title: string
    question: string
    options?: string[]
    details?: string
  }): Promise<{ approved: boolean; note?: string }> {
    return new Promise((resolve) => {
      const checkpoint = this.addCheckpoint({
        type: "decision_required",
        stage: opts.stage,
        agentId: "ceo",
        title: opts.title,
        description: opts.details,
      })

      this.state.pendingDecision = {
        checkpointId: checkpoint.id,
        question: opts.question,
        options: opts.options ?? ["批准", "拒绝"],
      }

      this.emit("multi-agent:decision-request", {
        sessionId: this.sessionId,
        checkpoint,
        question: opts.question,
        options: opts.options ?? ["批准", "拒绝"],
      })

      this.decisionResolver = (approved, note) => {
        this.state.pendingDecision = undefined
        checkpoint.approved = approved
        checkpoint.decision = note ?? (approved ? "用户批准" : "用户拒绝")
        this.emit("multi-agent:checkpoint", { sessionId: this.sessionId, checkpoint })
        resolve({ approved, note })
      }
    })
  }

  /**
   * 由 IPC handler 调用，响应用户决策。
   */
  resolveDecision(approved: boolean, note?: string): void {
    if (this.decisionResolver) {
      this.decisionResolver(approved, note)
      this.decisionResolver = null
    }
  }

  get hasPendingDecision(): boolean {
    return this.decisionResolver !== null
  }

  // ─── 单任务执行（并行单元） ───────────────────────────────

  private async executeSingleTask(
    task: CollaborationTask,
    context: string,
    deps: {
      executeTask: (
        task: CollaborationTask,
        agent: AgentDefinition,
        context: string,
      ) => Promise<string>
    },
  ): Promise<void> {
    if (this.aborted) return

    const agent = getAgentById(task.assignedAgentId)
    if (!agent) {
      this.updateTask(task.id, { status: "failed", result: "Agent 不存在" })
      return
    }

    this.updateTask(task.id, { status: "in_progress", startedAt: Date.now() })

    this.addMessage({
      type: "task_assignment",
      fromAgentId: "ceo",
      toAgentId: agent.id,
      stage: "execution",
      content: `任务：${task.title}`,
      taskId: task.id,
    })

    try {
      const result = await deps.executeTask(task, agent, context)
      this.updateTask(task.id, { status: "needs_review", result, completedAt: Date.now() })

      this.addMessage({
        type: "task_result",
        fromAgentId: agent.id,
        toAgentId: "ceo",
        stage: "execution",
        content: `任务完成：${task.title}`,
        taskId: task.id,
      })

      this.addCheckpoint({
        type: "task_completed",
        stage: "execution",
        agentId: agent.id,
        title: `任务完成：${task.title}`,
        description: result.slice(0, 200),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.updateTask(task.id, {
        status: "failed",
        result: `执行失败：${msg}`,
        completedAt: Date.now(),
      })
      this.addCheckpoint({
        type: "review_failed",
        stage: "execution",
        agentId: agent.id,
        title: `任务失败：${task.title}`,
        description: msg,
      })
    }
  }

  // ─── 工作区产物写入 ───────────────────────────────────────

  /**
   * 将协作结果写入工作区文件。
   * 文件命名：dave-collab-<timestamp>-<slug>.md
   */
  async writeArtifactToWorkspace(result: string): Promise<string | null> {
    try {
      const { writeFile } = await import("node:fs/promises")
      const { join } = await import("node:path")
      const { getStore } = await import("../store")

      const workspace = (getStore().get("cwd") as string) || ""
      if (!workspace) return null

      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")
      const slug = this.state.goal.slice(0, 30).replace(/[^\w\u4e00-\u9fa5]/g, "_")
      const filename = `dave-collab-${timestamp}-${slug}.md`
      const filepath = join(workspace, filename)

      const content = `# ${this.state.goal}

> 由 Dave 多 Agent 协作生成 · ${new Date().toLocaleString("zh-CN")}

## 团队
${this.state.agents.map((a) => `- **${a.name}** (${a.role}): ${a.description}`).join("\n")}

## 任务执行记录
${this.state.tasks
  .map((t, i) => {
    const agent = getAgentById(t.assignedAgentId)
    return `### ${i + 1}. ${t.title}
- **负责人**: ${agent?.name ?? t.assignedAgentId}
- **状态**: ${t.status}
- **结果**:
${(t.result || "（无结果）").slice(0, 2000)}
`
  })
  .join("\n")}

## 最终结果
${result}

## 检查点
${this.state.checkpoints.map((cp) => `- [${new Date(cp.timestamp).toLocaleTimeString("zh-CN")}] ${cp.title}${cp.description ? `: ${cp.description.slice(0, 100)}` : ""}`).join("\n")}
`

      await writeFile(filepath, content, "utf-8")
      log.info(`[multi-agent] artifact written: ${filepath}`)
      return filepath
    } catch (err) {
      log.warn(
        "[multi-agent] writeArtifact failed:",
        err instanceof Error ? err.message : String(err),
      )
      return null
    }
  }

  // ─── 事件发射 ────────────────────────────────────────────

  private emit(channel: string, data: unknown): void {
    if (!this.window || this.window.isDestroyed()) return
    this.window.webContents.send(channel, data)
  }

  private addCheckpoint(checkpoint: Omit<Checkpoint, "id" | "timestamp">): Checkpoint {
    const cp: Checkpoint = {
      ...checkpoint,
      id: ulid(),
      timestamp: Date.now(),
    }
    this.state.checkpoints.push(cp)
    this.emit("multi-agent:checkpoint", { sessionId: this.sessionId, checkpoint: cp })

    // 同步到画布
    this.addCanvasNode({
      type: "checkpoint",
      refId: cp.id,
      title: cp.title,
      subtitle: cp.type,
      status: cp.approved === false ? "error" : cp.approved === true ? "completed" : "active",
    })

    return cp
  }

  private addMessage(
    message: Omit<CollaborationMessage, "id" | "timestamp">,
  ): CollaborationMessage {
    const msg: CollaborationMessage = {
      ...message,
      id: ulid(),
      timestamp: Date.now(),
    }
    this.state.messages.push(msg)
    this.emit("multi-agent:message", { sessionId: this.sessionId, message: msg })
    return msg
  }

  private addTask(task: Omit<CollaborationTask, "id" | "createdAt" | "status">): CollaborationTask {
    const t: CollaborationTask = {
      ...task,
      id: ulid(),
      status: "pending",
      createdAt: Date.now(),
    }
    this.state.tasks.push(t)
    this.emit("multi-agent:task", { sessionId: this.sessionId, task: t })

    // 同步到画布
    const agent = getAgentById(t.assignedAgentId)
    this.addCanvasNode({
      type: "task",
      refId: t.id,
      title: t.title,
      subtitle: agent?.name ?? t.assignedAgentId,
      color: agent?.color,
      status: "idle",
    })

    return t
  }

  private updateTask(taskId: string, updates: Partial<CollaborationTask>): void {
    const task = this.state.tasks.find((t) => t.id === taskId)
    if (!task) return
    Object.assign(task, updates)
    this.emit("multi-agent:task", { sessionId: this.sessionId, task })
  }

  private transitionStage(to: Parameters<StageMachine["transition"]>[0]): void {
    const info = this.stageMachine.transition(to)
    if (!info) return
    this.state.stage = to
    this.state.stageHistory = this.stageMachine.stageHistory
    this.emit("multi-agent:stage", { sessionId: this.sessionId, stage: to, stageInfo: info })
  }

  // ─── 画布管理 ────────────────────────────────────────────

  private addCanvasNode(
    node: Omit<CanvasNode, "id" | "x" | "y" | "width" | "height"> & { x?: number; y?: number },
  ): CanvasNode {
    const existing = this.state.canvas.nodes.length
    const n: CanvasNode = {
      ...node,
      id: ulid(),
      x: node.x ?? 80 + (existing % 3) * 220,
      y: node.y ?? 80 + Math.floor(existing / 3) * 160,
      width: 200,
      height: 80,
    }
    this.state.canvas.nodes.push(n)
    this.emit("multi-agent:canvas", { sessionId: this.sessionId, canvas: this.state.canvas })
    return n
  }

  private addCanvasEdge(edge: Omit<CanvasEdge, "id">): void {
    const e: CanvasEdge = { ...edge, id: ulid() }
    this.state.canvas.edges.push(e)
    this.emit("multi-agent:canvas", { sessionId: this.sessionId, canvas: this.state.canvas })
  }

  // ─── 主流程 ──────────────────────────────────────────────

  /**
   * 启动协作：组队 → 计划 → 执行 → 审查 → 完成
   * 这是一个简化版编排，实际 LLM 调用通过回调注入。
   */
  async start(
    event: IpcMainInvokeEvent,
    deps: {
      getWindow: () => BrowserWindow | null
      planGoal: (
        goal: string,
        agents: AgentDefinition[],
      ) => Promise<{ title: string; description: string; assignedAgentId: string }[]>
      executeTask: (
        task: CollaborationTask,
        agent: AgentDefinition,
        context: string,
      ) => Promise<string>
      reviewResult: (
        task: CollaborationTask,
        result: string,
      ) => Promise<{ passed: boolean; feedback: string }>
      negotiate: (
        task: CollaborationTask,
        result: string,
        feedback: string,
      ) => Promise<{
        passed: boolean
        result: string
        rounds: number
        specialistResponse: string
        reviewerFinalFeedback: string
      }>
      ceoDecide: (
        task: CollaborationTask,
        result: string,
        feedback: string,
        specialistResponse: string,
      ) => Promise<{
        passed: boolean
        result: string
        decision: string
      }>
      synthesize: (goal: string, tasks: CollaborationTask[]) => Promise<string>
    },
  ): Promise<void> {
    this.window = deps.getWindow()
    const { goal } = this.state

    try {
      // ── 阶段 1: 组队 ──
      this.transitionStage("team_formation")
      const specialists = selectSpecialistsForGoal(goal)
      this.state.agents = [CEO_AGENT, ...specialists]

      // 添加 Agent 到画布
      this.state.agents.forEach((agent, i) => {
        this.addCanvasNode({
          type: "agent",
          refId: agent.id,
          title: agent.name,
          subtitle: agent.description,
          color: agent.color,
          x: 60 + i * 160,
          y: 40,
          status: i === 0 ? "active" : "idle",
        })
      })

      this.addCheckpoint({
        type: "team_formed",
        stage: "team_formation",
        agentId: "ceo",
        title: "团队组建完成",
        description: `CEO + ${specialists.map((a) => a.name).join("、")}`,
      })

      if (this.aborted) return

      // ── 决策关口 1: 开工授权 ──
      const teamApproval = await this.requestDecision({
        checkpointType: "decision_required",
        stage: "team_formation",
        title: "开工授权",
        question: `CEO 已组建团队（${specialists.map((a) => a.name).join("、")}），是否开始执行？`,
        options: ["开始执行", "取消"],
        details: `目标：${goal}\n团队：CEO + ${specialists.map((a) => a.name).join("、")}`,
      })
      if (!teamApproval.approved) {
        this.addCheckpoint({
          type: "review_failed",
          stage: "team_formation",
          agentId: "ceo",
          title: "用户取消协作",
          description: teamApproval.note ?? "用户拒绝开工授权",
        })
        this.transitionStage("completed")
        this.state.finalResult = "协作已取消"
        this.state.completedAt = Date.now()
        this.emit("multi-agent:complete", {
          sessionId: this.sessionId,
          result: "协作已取消",
          checkpoints: this.state.checkpoints,
        })
        return
      }

      if (this.aborted) return

      // ── 阶段 2: 计划 ──
      this.transitionStage("planning")
      this.addMessage({
        type: "status_update",
        fromAgentId: "ceo",
        stage: "planning",
        content: `正在分析目标：${goal}`,
      })

      const taskDefs = await deps.planGoal(goal, this.state.agents)
      const tasks = taskDefs.map((def) => this.addTask(def))

      this.addCheckpoint({
        type: "plan_approved",
        stage: "planning",
        agentId: "ceo",
        title: "执行计划已制定",
        description: `共 ${tasks.length} 个任务`,
      })

      // 画布连线：CEO → 任务
      const ceoNode = this.state.canvas.nodes.find((n) => n.refId === "ceo")
      tasks.forEach((task) => {
        const taskNode = this.state.canvas.nodes.find((n) => n.refId === task.id)
        if (ceoNode && taskNode) {
          this.addCanvasEdge({
            fromNodeId: ceoNode.id,
            toNodeId: taskNode.id,
            type: "flow",
            label: "分配",
          })
        }
      })

      if (this.aborted) return

      // ── 决策关口 2: 计划复核 ──
      const planDetails = tasks
        .map(
          (t, i) =>
            `${i + 1}. ${t.title}（${getAgentById(t.assignedAgentId)?.name ?? t.assignedAgentId}）：${t.description}`,
        )
        .join("\n")
      const planApproval = await this.requestDecision({
        checkpointType: "decision_required",
        stage: "planning",
        title: "计划复核",
        question: `CEO 已制定 ${tasks.length} 个任务的执行计划，是否批准执行？`,
        options: ["批准执行", "修改后重试", "取消"],
        details: planDetails,
      })
      if (!planApproval.approved) {
        if (planApproval.note === "修改后重试") {
          // 用户要求修改计划，重新规划
          this.addMessage({
            type: "status_update",
            fromAgentId: "ceo",
            stage: "planning",
            content: `用户要求修改计划：${planApproval.note}`,
          })
          // 重新规划（简化：直接用原计划，实际应该重新调用 planGoal）
          this.addCheckpoint({
            type: "plan_approved",
            stage: "planning",
            agentId: "ceo",
            title: "计划已调整",
            description: "根据用户反馈调整后继续执行",
          })
        } else {
          this.addCheckpoint({
            type: "review_failed",
            stage: "planning",
            agentId: "ceo",
            title: "用户取消协作",
            description: planApproval.note ?? "用户拒绝计划",
          })
          this.transitionStage("completed")
          this.state.finalResult = "协作已取消"
          this.state.completedAt = Date.now()
          this.emit("multi-agent:complete", {
            sessionId: this.sessionId,
            result: "协作已取消",
            checkpoints: this.state.checkpoints,
          })
          return
        }
      }

      if (this.aborted) return

      // ── 阶段 3: 执行（并行） ──
      this.transitionStage("execution")
      const context = `目标：${goal}\n\n任务列表：\n${tasks.map((t, i) => `${i + 1}. ${t.title}：${t.description}`).join("\n")}`

      // 所有任务并行执行（当前无依赖关系，后续可根据 dependsOn 分批）
      await Promise.all(tasks.map((task) => this.executeSingleTask(task, context, deps)))

      this.state.activeAgentId = undefined

      if (this.aborted) return

      // ── 阶段 4: 审查（含协商/辩论） ──
      this.transitionStage("review")
      const reviewer = getAgentById("reviewer")

      for (const task of this.state.tasks.filter((t) => t.status === "needs_review")) {
        if (!task.result) continue
        const review = reviewer
          ? await deps.reviewResult(task, task.result)
          : { passed: true, feedback: "无审查员，自动通过" }

        if (review.passed) {
          this.updateTask(task.id, { status: "completed", review: review.feedback })
          this.addMessage({
            type: "review_feedback",
            fromAgentId: reviewer?.id ?? "ceo",
            stage: "review",
            content: `审查通过：${task.title}`,
            taskId: task.id,
          })
          continue
        }

        // 审查不通过 → 触发协商/辩论
        this.addMessage({
          type: "review_feedback",
          fromAgentId: reviewer?.id ?? "ceo",
          stage: "review",
          content: `审查不通过，启动协商：${task.title}`,
          taskId: task.id,
        })
        this.addCheckpoint({
          type: "review_failed",
          stage: "review",
          agentId: reviewer?.id ?? "ceo",
          title: `审查不通过：${task.title}`,
          description: review.feedback.slice(0, 200),
        })

        // 协商：Specialist 辩护 → Reviewer 复审
        const negotiation = await deps.negotiate(task, task.result, review.feedback)
        this.addMessage({
          type: "review_feedback",
          fromAgentId: task.assignedAgentId,
          stage: "review",
          content: `协商 ${negotiation.rounds} 轮，${negotiation.passed ? "通过" : "未通过"}：${task.title}`,
          taskId: task.id,
        })

        if (negotiation.passed) {
          this.updateTask(task.id, {
            status: "completed",
            result: negotiation.result,
            review: negotiation.reviewerFinalFeedback,
          })
          this.addCheckpoint({
            type: "review_passed",
            stage: "review",
            agentId: reviewer?.id ?? "ceo",
            title: `协商通过：${task.title}`,
            description: `经过 ${negotiation.rounds} 轮协商，审查员最终通过`,
          })
          continue
        }

        // 协商失败 → CEO 裁决
        const ceoDecision = await deps.ceoDecide(
          task,
          negotiation.result,
          negotiation.reviewerFinalFeedback,
          negotiation.specialistResponse,
        )
        this.addMessage({
          type: "ceo_synthesis",
          fromAgentId: "ceo",
          stage: "review",
          content: `CEO 裁决：${ceoDecision.passed ? "通过" : "驳回"} — ${ceoDecision.decision}`,
          taskId: task.id,
        })

        if (ceoDecision.passed) {
          this.updateTask(task.id, {
            status: "completed",
            result: ceoDecision.result,
            review: `CEO 裁决通过：${ceoDecision.decision}`,
          })
          this.addCheckpoint({
            type: "review_passed",
            stage: "review",
            agentId: "ceo",
            title: `CEO 裁决通过：${task.title}`,
            description: ceoDecision.decision.slice(0, 200),
          })
          continue
        }

        // CEO 也驳回 → 升级到用户决策
        const userDecision = await this.requestDecision({
          checkpointType: "decision_required",
          stage: "review",
          title: `争议升级：${task.title}`,
          question: `审查员和 CEO 都驳回了"${task.title}"的结果。是否仍然接受该结果？`,
          options: ["接受结果", "驳回重做"],
          details: `审查反馈：${negotiation.reviewerFinalFeedback}\n\n负责人辩护：${negotiation.specialistResponse.slice(0, 500)}\n\nCEO 裁决：${ceoDecision.decision}`,
        })

        if (userDecision.approved) {
          this.updateTask(task.id, {
            status: "completed",
            result: negotiation.result,
            review: `用户最终接受（原审查驳回）`,
          })
          this.addCheckpoint({
            type: "review_passed",
            stage: "review",
            agentId: "ceo",
            title: `用户接受：${task.title}`,
            description: "尽管审查和 CEO 都驳回，用户最终接受该结果",
          })
        } else {
          this.updateTask(task.id, {
            status: "failed",
            result: negotiation.result,
            review: `用户驳回：需要重做`,
          })
          this.addCheckpoint({
            type: "review_failed",
            stage: "review",
            agentId: "ceo",
            title: `用户驳回：${task.title}`,
            description: "用户决定驳回该任务结果，需要重新执行",
          })
        }
      }

      this.addCheckpoint({
        type: "review_passed",
        stage: "review",
        agentId: "reviewer",
        title: "审查完成",
        description: `${this.state.tasks.filter((t) => t.status === "completed").length}/${this.state.tasks.length} 任务通过（含协商与裁决）`,
      })

      if (this.aborted) return

      // ── 阶段 5: 完成 ──
      this.transitionStage("completed")
      const finalResult = await deps.synthesize(goal, this.state.tasks)
      this.state.finalResult = finalResult
      this.state.completedAt = Date.now()

      // 保存协作状态到工作区
      await saveCollaboration(this.state)

      // 写入工作区产物
      const artifactPath = await this.writeArtifactToWorkspace(finalResult)

      this.addCheckpoint({
        type: "completed",
        stage: "completed",
        agentId: "ceo",
        title: "协作完成",
        description: finalResult.slice(0, 200),
      })

      this.emit("multi-agent:complete", {
        sessionId: this.sessionId,
        result: finalResult,
        checkpoints: this.state.checkpoints,
        artifactPath,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error("[multi-agent] collaboration failed:", msg)
      this.addCheckpoint({
        type: "review_failed",
        stage: this.state.stage,
        agentId: "ceo",
        title: "协作出错",
        description: msg,
      })
      this.emit("multi-agent:error", { sessionId: this.sessionId, error: msg })
    } finally {
      activeCollaborations.delete(this.sessionId)
    }
  }
}
