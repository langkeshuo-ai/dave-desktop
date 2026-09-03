/**
 * Agent Definitions — 内置 Agent 定义库
 *
 * CEO 带队，按需选择 Specialist 分工协作。
 * 每个 Agent 有独立的系统提示词和工具权限。
 */
import type { AgentDefinition, AgentRole } from "./types"

// ─── 内置 Agent 定义 ───────────────────────────────────────

export const CEO_AGENT: AgentDefinition = {
  id: "ceo",
  name: "CEO",
  role: "ceo",
  description: "团队负责人，分析目标、制定计划、分配任务、汇总结果",
  systemPrompt: `你是一个 AI 团队的 CEO。你的职责：
1. 分析用户目标，判断任务复杂度
2. 选择合适的 Specialist 组队
3. 制定执行计划，分解任务
4. 分配任务给 Specialist
5. 收集结果，审查质量
6. 汇总最终产物

你不直接执行具体任务，而是通过协调团队完成。
在需要用户决策时（开工授权、计划复核、重大选择），停下来询问用户。`,
  color: "#6366F1",
  icon: "Crown",
}

export const CODER_AGENT: AgentDefinition = {
  id: "coder",
  name: "程序员",
  role: "coder",
  description: "代码专家，负责编写、修改、审查代码",
  systemPrompt: `你是一个资深程序员。你的职责：
1. 编写高质量代码
2. 修改现有代码
3. 代码审查和重构
4. 调试和修复 bug
5. 编写测试

使用工具读写文件、执行 shell 命令。代码要简洁、有注释、遵循最佳实践。`,
  allowedTools: [
    "read_file",
    "write_file",
    "apply_patch",
    "remove",
    "shell",
    "ast_grep",
    "file_tree",
  ],
  color: "#10B981",
  icon: "Code2",
}

export const RESEARCHER_AGENT: AgentDefinition = {
  id: "researcher",
  name: "研究员",
  role: "researcher",
  description: "研究专家，负责信息检索、技术调研、方案分析",
  systemPrompt: `你是一个研究专家。你的职责：
1. 检索和整理信息
2. 技术调研和方案对比
3. 分析问题，给出建议
4. 撰写研究报告

使用搜索工具和文件读取工具获取信息。报告要结构清晰、有数据支撑、给出明确建议。`,
  allowedTools: ["read_file", "shell", "ast_grep", "file_tree", "list_files"],
  color: "#F59E0B",
  icon: "Search",
}

export const WRITER_AGENT: AgentDefinition = {
  id: "writer",
  name: "文案",
  role: "writer",
  description: "文案专家，负责文档撰写、内容编辑、文案润色",
  systemPrompt: `你是一个文案专家。你的职责：
1. 撰写文档和文章
2. 编辑和润色内容
3. 优化表达和结构
4. 撰写营销文案

内容要清晰、有逻辑、有吸引力。根据目标受众调整语气和风格。`,
  allowedTools: ["read_file", "write_file", "apply_patch"],
  color: "#EC4899",
  icon: "PenLine",
}

export const REVIEWER_AGENT: AgentDefinition = {
  id: "reviewer",
  name: "审查员",
  role: "reviewer",
  description: "质量审查专家，负责审查其他 Agent 的产出",
  systemPrompt: `你是一个质量审查专家。你的职责：
1. 审查代码质量（规范、安全、性能）
2. 审查文档准确性
3. 审查方案可行性
4. 给出修改建议

审查要客观、具体、可操作。发现问题要指出位置和改进方向。`,
  allowedTools: ["read_file", "ast_grep", "file_tree", "list_files"],
  color: "#8B5CF6",
  icon: "ShieldCheck",
}

// ─── Agent 注册表 ──────────────────────────────────────────

export const BUILTIN_AGENTS: AgentDefinition[] = [
  CEO_AGENT,
  CODER_AGENT,
  RESEARCHER_AGENT,
  WRITER_AGENT,
  REVIEWER_AGENT,
]

export function getAgentById(id: string): AgentDefinition | undefined {
  return BUILTIN_AGENTS.find((a) => a.id === id)
}

/**
 * 根据目标自动选择 Specialist（CEO 始终在场）。
 * 简单规则：根据关键词匹配角色。
 */
export function selectSpecialistsForGoal(goal: string): AgentDefinition[] {
  const lower = goal.toLowerCase()
  const specialists: AgentDefinition[] = []

  // 代码相关
  if (/(代码|code|编程|程序|bug|修复|重构|函数|类|api|接口|模块)/.test(lower)) {
    specialists.push(CODER_AGENT)
  }
  // 研究/调研相关
  if (/(研究|调研|分析|方案|对比|选型|技术|怎么|如何)/.test(lower)) {
    specialists.push(RESEARCHER_AGENT)
  }
  // 文档/文案相关
  if (/(文档|文章|文案|写|撰写|编辑|润色|报告|说明)/.test(lower)) {
    specialists.push(WRITER_AGENT)
  }
  // 默认至少加一个研究员
  if (specialists.length === 0) {
    specialists.push(RESEARCHER_AGENT)
  }

  // 复杂任务加审查员
  if (specialists.length >= 2 || /(复杂|大型|系统|架构|项目)/.test(lower)) {
    specialists.push(REVIEWER_AGENT)
  }

  return specialists
}

export function roleLabel(role: AgentRole): string {
  const labels: Record<AgentRole, string> = {
    ceo: "CEO",
    specialist: "专家",
    reviewer: "审查员",
    coder: "程序员",
    researcher: "研究员",
    writer: "文案",
  }
  return labels[role]
}
