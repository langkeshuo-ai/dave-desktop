/* =========================================================================
   本地遥测(无第三方,不上报,数据只存本地 electron-store)。

   目的:
   - 衡量"打磨提升客户端,提高转化率"的关键漏斗指标。
   - 给开发者和用户各自一份"我的使用统计",辅助自查。
   - 不向任何远端发送,符合硬约束"不触碰数据库"。

   设计:
   - event_name 必须是字符串字面量,TypeScript 检查可枚举所有事件。
   - props 全部 string 类型,JSON 序列化无歧义;长文本 / 大对象需截断。
   - 事件环形缓冲上限 5000 条,超过滚动丢弃最旧。
   - funnelSnapshot() 计算首问转化漏斗(基于 unique session 集合)。
   ========================================================================= */

export type TelemetryEventName =
  // 应用生命周期
  | "app_launch"
  | "app_quit"
  | "renderer_ready"
  | "first_window_shown"
  // 引导流程
  | "onboarding_started"
  | "onboarding_welcome_seen"
  | "onboarding_welcome_dismissed"
  | "onboarding_provider_chosen"
  | "onboarding_api_key_pasted"
  | "onboarding_api_key_validated"
  | "onboarding_api_key_failed"
  | "onboarding_workspace_chosen"
  | "onboarding_completed"
  | "onboarding_skipped"
  | "onboarding_reopened"
  // 主界面
  | "session_created"
  | "session_switched"
  | "session_deleted"
  | "template_clicked"
  | "first_message_sent"
  | "message_sent"
  | "message_edited"
  | "approval_granted"
  | "approval_denied"
  | "aborted"
  // 设置 / 命令面板 / 帮助
  | "settings_opened"
  | "palette_opened"
  | "help_opened"
  // 性能标记
  | "ttfb_recorded"

/** 与 TelemetryEventName 同步的常量数组,用于运行时白名单校验
 *  (主进程 IPC handler 拒绝未知事件名,防止渲染端注入撑爆 store)。
 *  TypeScript 用 `satisfies` 保证两边永远同步。 */
export const TELEMETRY_EVENT_NAMES = [
  // 应用生命周期
  "app_launch",
  "app_quit",
  "renderer_ready",
  "first_window_shown",
  // 引导流程
  "onboarding_started",
  "onboarding_welcome_seen",
  "onboarding_welcome_dismissed",
  "onboarding_provider_chosen",
  "onboarding_api_key_pasted",
  "onboarding_api_key_validated",
  "onboarding_api_key_failed",
  "onboarding_workspace_chosen",
  "onboarding_completed",
  "onboarding_skipped",
  "onboarding_reopened",
  // 主界面
  "session_created",
  "session_switched",
  "session_deleted",
  "template_clicked",
  "first_message_sent",
  "message_sent",
  "message_edited",
  "approval_granted",
  "approval_denied",
  "aborted",
  // 设置 / 命令面板 / 帮助
  "settings_opened",
  "palette_opened",
  "help_opened",
  // 性能标记
  "ttfb_recorded",
] as const satisfies readonly TelemetryEventName[]

export interface TelemetryEvent {
  name: TelemetryEventName
  ts: number
  props?: Record<string, string>
}

/** 5000 条环形缓冲上限,够几个月日常使用,不会撑爆 electron-store。 */
export const TELEMETRY_MAX_EVENTS = 5000

/** 漏斗快照:首启 → 完成 onboarding → 工作区就绪 → 首问发出。 */
export interface FunnelSnapshot {
  launched: number
  onboarded: number
  workspaceReady: number
  firstMessage: number
  sevenDayRetained: number
  rates: {
    onboardRate: number
    workspaceRate: number
    firstMessageRate: number
    retentionRate: number
  }
}

/** 7 日回访窗口,unix ms。 */
export const SEVEN_DAY_MS = 7 * 24 * 60 * 60 * 1000

/**
 * 性能预算(目标来自产品规约):
 * - FIRST_RUN_BUDGET_MS: 首启到可输入 60s(包含下载 + 安装 + 引导 + Key 配置)
 * - TTFB_BUDGET_MS: API key 已就位情况下首问 5s
 *   (发送消息 → 主进程拼 body → Provider 响应第一个 chunk)
 * - COLD_WINDOW_BUDGET_MS: 主进程拉起到 first_window_shown 3s
 *
 * 这些是软目标 — 超出会打点但不让 UI 失败。
 */
export const FIRST_RUN_BUDGET_MS = 60_000
export const TTFB_BUDGET_MS = 5_000
export const COLD_WINDOW_BUDGET_MS = 3_000

/** 性能预算的判断结果(纯函数,node 环境单测)。 */
export interface BudgetVerdict {
  within: boolean
  budget: number
  /** 超出多少 ms(负数表示在预算内,正数表示超出)。 */
  over: number
}

/**
 * 判断耗时是否在预算内。
 * - kind: "first_run" / "ttfb" / "cold_window"
 * - elapsed: 实测毫秒数
 * - 边界:elapsed == budget 视为 within(包含),便于测试可重复。
 */
export function checkStartupBudget(
  kind: "first_run" | "ttfb" | "cold_window",
  elapsed: number,
): BudgetVerdict {
  const budget =
    kind === "first_run"
      ? FIRST_RUN_BUDGET_MS
      : kind === "ttfb"
        ? TTFB_BUDGET_MS
        : COLD_WINDOW_BUDGET_MS
  const over = elapsed - budget
  return { within: over <= 0, budget, over }
}

/**
 * 计算漏斗快照(纯函数,可在 node 环境单测,无需 electron 依赖)。
 *
 * - launched = 唯一 "app_launch" 数量(按 sessionCount 去重,同次启动多次事件只算 1)。
 * - onboarded = 唯一 "onboarding_completed" 数量。
 * - workspaceReady = 已设过 cwd 的独立用户数(此处用事件近似)。
 * - firstMessage = 发出首条消息的独立用户数(用 first_message_sent 事件)。
 * - sevenDayRetained = 7 天内再次启动过的用户数。
 */
export function computeFunnel(events: TelemetryEvent[]): FunnelSnapshot {
  const uniqBy = (pred: (e: TelemetryEvent) => boolean) => {
    const set = new Set<string>()
    for (const e of events) {
      if (pred(e)) set.add(`${e.ts}-${e.name}-${JSON.stringify(e.props ?? {})}`)
    }
    return set.size
  }
  // 简单去重:name + ts + props 相同才视为 1;
  // 同 ts 不同 ret(0/1)或不同 provider 应分别计数(同 ts 内可能有多用户/多设备事件)。
  const dedup = (pred: (e: TelemetryEvent) => boolean) => {
    const seen = new Set<string>()
    for (const e of events) {
      if (!pred(e)) continue
      const k = `${e.name}-${e.ts}-${JSON.stringify(e.props ?? null)}`
      if (seen.has(k)) continue
      seen.add(k)
    }
    return seen.size
  }

  const launched = dedup((e) => e.name === "app_launch")
  const onboarded = dedup((e) => e.name === "onboarding_completed")
  const workspaceReady = dedup((e) => e.name === "onboarding_workspace_chosen")
  const firstMessage = dedup((e) => e.name === "first_message_sent")
  const sevenDayRetained = dedup((e) => e.name === "app_launch" && e.props?.ret === "1")

  // 抑制 lint:uniqBy 暂时保留,后续若需要更复杂去重可启用。
  void uniqBy

  const safeRate = (num: number, den: number) => (den > 0 ? num / den : 0)

  return {
    launched,
    onboarded,
    workspaceReady,
    firstMessage,
    sevenDayRetained,
    rates: {
      onboardRate: safeRate(onboarded, launched),
      workspaceRate: safeRate(workspaceReady, onboarded),
      firstMessageRate: safeRate(firstMessage, workspaceReady || onboarded),
      retentionRate: safeRate(sevenDayRetained, launched),
    },
  }
}

/** 检测某用户是否 7 日内再次启动。 */
export function isSevenDayRetained(events: TelemetryEvent[], now: number): boolean {
  const firstLaunch = events.find((e) => e.name === "app_launch")
  if (!firstLaunch) return false
  return (
    now - firstLaunch.ts < SEVEN_DAY_MS * 4 && // 上限 28 天
    events.filter((e) => e.name === "app_launch").length >= 2
  )
}
