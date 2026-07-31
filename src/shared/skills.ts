/* =========================================================================
   Skills(用户自定义预置技能)——ROADMAP_0.3.0 M1 第一步。

   技能 = 用户可添加的命名预置 prompt(名称/描述/内容),存 store key "skills"
   (JSON 数组)。扩展 tab 管理(增删 + 复制内容)。与 EmptyStateTemplates(内置
   模板)的区别:skills 是用户自定义的,0.3.0 完整版将注册到 agent 工具循环。
   纯函数(node 环境可单测),main 层只做 adapter。
   ========================================================================= */

export interface SkillDefinition {
  name: string
  description: string
  content: string
}

export const SKILL_NAME_RE = /^[a-zA-Z0-9_-]{1,48}$/
export const SKILL_DESC_MAX = 200
export const SKILL_CONTENT_MAX = 2_000

/** 校验单个技能;非法返回 null。 */
export function validateSkill(raw: unknown): SkillDefinition | null {
  if (typeof raw !== "object" || raw === null) return null
  const { name, description, content } = raw as Record<string, unknown>
  if (typeof name !== "string" || !SKILL_NAME_RE.test(name)) return null
  if (typeof description !== "string" || description.length > SKILL_DESC_MAX) return null
  if (
    typeof content !== "string" ||
    content.trim().length === 0 ||
    content.length > SKILL_CONTENT_MAX
  ) {
    return null
  }
  return { name, description, content }
}

/** 解析技能列表:过滤非法项 + 去重(同名只保留首个)。 */
export function parseSkills(raw: unknown): SkillDefinition[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: SkillDefinition[] = []
  for (const item of raw) {
    const s = validateSkill(item)
    if (!s || seen.has(s.name)) continue
    seen.add(s.name)
    out.push(s)
  }
  return out
}

/** 技能工具命名空间:`skill__<name>`(与 MCP 的 `mcp__server__tool` 同款隔离)。 */
export const SKILL_TOOL_PREFIX = "skill__"

export function isSkillToolName(name: string): boolean {
  return name.startsWith(SKILL_TOOL_PREFIX)
}

export function skillToolName(skillName: string): string {
  return `${SKILL_TOOL_PREFIX}${skillName}`
}

export function splitSkillToolName(name: string): string | null {
  if (!isSkillToolName(name)) return null
  const rest = name.slice(SKILL_TOOL_PREFIX.length)
  return rest.length > 0 ? rest : null
}

/** 按技能名查找(供 agent 工具分支用)。 */
export function findSkill(skills: SkillDefinition[], name: string): SkillDefinition | undefined {
  return skills.find((s) => s.name === name)
}

/** 技能 → LLM 工具定义(agent 循环 advertise 用,纯函数可单测)。 */
export function skillToolDefs(skills: SkillDefinition[]): Record<string, unknown>[] {
  return skills.map((s) => ({
    type: "function",
    function: {
      name: skillToolName(s.name),
      description: s.description || `技能：${s.name}`,
      parameters: { type: "object", properties: {} },
    },
  }))
}

/** 技能工具结果内容(纯函数,可单测;与 chat-loop runToolCalls 技能分支对齐)。 */
export function skillNotFoundContent(name: string): string {
  return `错误：未知技能 ${name}`
}
export function skillAppliedContent(skill: SkillDefinition): string {
  return `技能「${skill.name}」已启用：${skill.description}\n\n${skill.content}`
}
export function skillDeniedContent(): string {
  return "用户拒绝了此操作（或会话已中止）"
}
