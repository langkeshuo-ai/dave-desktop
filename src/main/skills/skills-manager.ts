/**
 * Skills Manager — 技能管理器
 *
 * 从 zcode-client 的 skills.mjs 迁移，TypeScript 重写。
 * 提供技能发现、加载、搜索、系统提示词生成能力。
 *
 * 技能标准：Agent Skills 1.0
 * - 路径：~/.agents/skills/（全局）+ .agents/skills/（项目级）+ ~/.dave/skills/
 * - 格式：SKILL.md（YAML frontmatter + Markdown body）
 * - 可选：references/ 目录、test-prompts.json
 */
import fs from "node:fs"
import path from "node:path"
import { daveSkillsRoots } from "../utils/paths"

// ─── 类型 ────────────────────────────────────────────────

export interface SkillMeta {
  name?: string
  description?: string
  version?: string
  author?: string
  tags?: string
  [key: string]: string | undefined
}

export interface SkillSummary {
  name: string
  path: string
  skillMd: string
  root: string
  description: string
  bodyPreview: string
}

export interface SkillDetail {
  name: string
  path: string
  skillMd: string
  meta: SkillMeta
  body: string
  content: string
}

export interface ListSkillsOptions {
  limit?: number
  query?: string
}

// ─── Frontmatter 解析 ────────────────────────────────────

/**
 * 解析 Markdown 文件的 YAML frontmatter。
 * 支持简单的 key: value 格式（不支持嵌套 YAML）。
 */
function parseFrontmatter(md: string): { meta: SkillMeta; body: string } {
  if (!md.startsWith("---")) return { meta: {}, body: md }
  const end = md.indexOf("\n---", 3)
  if (end < 0) return { meta: {}, body: md }
  const raw = md.slice(3, end).trim()
  const body = md.slice(end + 4).replace(/^\r?\n/, "")
  const meta: SkillMeta = {}
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!m) continue
    let val = m[2].trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    meta[m[1]] = val
  }
  return { meta, body }
}

// ─── 技能发现 ─────────────────────────────────────────────

interface SkillDirItem {
  name: string
  dir: string
  skillMd: string
}

function listSkillDirs(root: string): SkillDirItem[] {
  if (!fs.existsSync(root)) return []
  const out: SkillDirItem[] = []
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue
    if (ent.name.startsWith(".")) continue
    const skillMd = path.join(root, ent.name, "SKILL.md")
    if (fs.existsSync(skillMd)) {
      out.push({ name: ent.name, dir: path.join(root, ent.name), skillMd })
    }
  }
  return out
}

// ─── 核心 API ─────────────────────────────────────────────

/**
 * 列出所有可用技能。
 * 按名称排序，去重（同名技能优先使用先扫描到的根目录）。
 * 支持 query 过滤（匹配名称或描述）。
 */
export function listSkills(options: ListSkillsOptions = {}): SkillSummary[] {
  const { limit = 300, query = "" } = options
  const seen = new Set<string>()
  const skills: SkillSummary[] = []
  const queryLower = query.toLowerCase()

  for (const root of daveSkillsRoots()) {
    for (const item of listSkillDirs(root)) {
      if (seen.has(item.name)) continue
      seen.add(item.name)

      let description = ""
      let bodyPreview = ""
      try {
        const md = fs.readFileSync(item.skillMd, "utf8")
        const { meta, body } = parseFrontmatter(md)
        description = meta.description || ""
        bodyPreview = body.slice(0, 240).replace(/\s+/g, " ").trim()
      } catch {
        // ignore unreadable skill
      }

      // query 过滤
      if (queryLower) {
        const matches =
          item.name.toLowerCase().includes(queryLower) ||
          description.toLowerCase().includes(queryLower)
        if (!matches) continue
      }

      skills.push({
        name: item.name,
        path: item.dir,
        skillMd: item.skillMd,
        root,
        description,
        bodyPreview,
      })

      if (skills.length >= limit) return skills
    }
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * 读取单个技能的完整内容。
 * 按根目录优先级搜索，返回第一个匹配的技能。
 */
export function readSkill(name: string): SkillDetail | null {
  for (const root of daveSkillsRoots()) {
    const skillMd = path.join(root, name, "SKILL.md")
    if (!fs.existsSync(skillMd)) continue
    const md = fs.readFileSync(skillMd, "utf8")
    const { meta, body } = parseFrontmatter(md)
    return {
      name,
      path: path.join(root, name),
      skillMd,
      meta,
      body,
      content: md,
    }
  }
  return null
}

/**
 * 为选中的技能生成系统提示词片段。
 * 最多包含 8 个技能，每个技能 body 最多 6000 字符。
 * 如果没有选中任何技能，返回空字符串。
 */
export function skillsSystemPrompt(selectedNames: string[] = []): string {
  if (!selectedNames.length) return ""
  const chunks: string[] = []
  for (const name of selectedNames.slice(0, 8)) {
    const skill = readSkill(name)
    if (!skill) continue
    chunks.push(`## Skill: ${skill.name}\n${skill.body.slice(0, 6000)}`)
  }
  if (!chunks.length) return ""
  return `You may use these local skills. Follow their instructions when relevant.\n\n${chunks.join("\n\n")}`
}

/**
 * 获取技能的 references 目录路径（如果存在）。
 */
export function getSkillReferencesPath(name: string): string | null {
  const skill = readSkill(name)
  if (!skill) return null
  const refsDir = path.join(skill.path, "references")
  return fs.existsSync(refsDir) ? refsDir : null
}

/**
 * 获取技能的 test-prompts.json 路径（如果存在）。
 */
export function getSkillTestPromptsPath(name: string): string | null {
  const skill = readSkill(name)
  if (!skill) return null
  const testFile = path.join(skill.path, "test-prompts.json")
  return fs.existsSync(testFile) ? testFile : null
}
