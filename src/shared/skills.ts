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
