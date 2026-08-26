/**
 * Skills Manager Tests — 技能管理器测试
 *
 * 覆盖 src/main/skills/skills-manager.ts 的核心功能。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { listSkills, readSkill, skillsSystemPrompt } from "../skills/skills-manager"

describe("skills-manager", () => {
  let tmpSkillsDir: string
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
    tmpSkillsDir = fs.mkdtempSync(path.join(os.tmpdir(), "dave-skills-test-"))

    // 创建测试技能
    const skillDir = path.join(tmpSkillsDir, "test-skill")
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: test-skill
description: A test skill for unit testing
version: 1.0.0
---

# Test Skill

This is a test skill body.
It contains instructions for the agent.
`,
    )

    // 创建第二个技能
    const skill2Dir = path.join(tmpSkillsDir, "another-skill")
    fs.mkdirSync(skill2Dir, { recursive: true })
    fs.writeFileSync(
      path.join(skill2Dir, "SKILL.md"),
      `---
name: another-skill
description: Another test skill
---

# Another Skill

Body content here.
`,
    )

    // 创建无 frontmatter 的技能
    const skill3Dir = path.join(tmpSkillsDir, "no-frontmatter")
    fs.mkdirSync(skill3Dir, { recursive: true })
    fs.writeFileSync(path.join(skill3Dir, "SKILL.md"), "# No Frontmatter\n\nJust markdown body.")

    // 设置环境变量指向测试目录
    process.env.DAVE_HOME = tmpSkillsDir
  })

  afterEach(() => {
    process.env = originalEnv
    fs.rmSync(tmpSkillsDir, { recursive: true, force: true })
  })

  describe("listSkills", () => {
    it("returns skills sorted by name", () => {
      const skills = listSkills()
      const names = skills.map((s) => s.name)
      expect(names).toEqual([...names].sort())
    })

    it("includes skill name, path, description", () => {
      const skills = listSkills()
      const testSkill = skills.find((s) => s.name === "test-skill")
      expect(testSkill).toBeDefined()
      expect(testSkill!.description).toBe("A test skill for unit testing")
      expect(path.isAbsolute(testSkill!.path)).toBe(true)
    })

    it("includes body preview", () => {
      const skills = listSkills()
      const testSkill = skills.find((s) => s.name === "test-skill")
      expect(testSkill!.bodyPreview).toContain("Test Skill")
    })

    it("handles skills without frontmatter", () => {
      const skills = listSkills()
      const noFm = skills.find((s) => s.name === "no-frontmatter")
      expect(noFm).toBeDefined()
      expect(noFm!.description).toBe("")
    })

    it("respects limit option", () => {
      const skills = listSkills({ limit: 1 })
      expect(skills.length).toBeLessThanOrEqual(1)
    })

    it("filters by query", () => {
      const skills = listSkills({ query: "another" })
      expect(skills.length).toBe(1)
      expect(skills[0].name).toBe("another-skill")
    })

    it("query matches description too", () => {
      const skills = listSkills({ query: "unit testing" })
      expect(skills.length).toBe(1)
      expect(skills[0].name).toBe("test-skill")
    })

    it("returns empty array for no matches", () => {
      const skills = listSkills({ query: "nonexistent-skill-xyz" })
      expect(skills).toEqual([])
    })

    it("ignores hidden directories", () => {
      const hiddenDir = path.join(tmpSkillsDir, ".hidden-skill")
      fs.mkdirSync(hiddenDir, { recursive: true })
      fs.writeFileSync(path.join(hiddenDir, "SKILL.md"), "# Hidden")
      const skills = listSkills()
      expect(skills.find((s) => s.name === ".hidden-skill")).toBeUndefined()
    })

    it("ignores directories without SKILL.md", () => {
      const emptyDir = path.join(tmpSkillsDir, "empty-skill")
      fs.mkdirSync(emptyDir, { recursive: true })
      const skills = listSkills()
      expect(skills.find((s) => s.name === "empty-skill")).toBeUndefined()
    })
  })

  describe("readSkill", () => {
    it("returns full skill content", () => {
      const skill = readSkill("test-skill")
      expect(skill).not.toBeNull()
      expect(skill!.name).toBe("test-skill")
      expect(skill!.meta.description).toBe("A test skill for unit testing")
      expect(skill!.meta.version).toBe("1.0.0")
      expect(skill!.body).toContain("Test Skill")
      expect(skill!.content).toContain("---")
    })

    it("returns null for nonexistent skill", () => {
      const skill = readSkill("nonexistent-skill")
      expect(skill).toBeNull()
    })

    it("parses frontmatter with quoted values", () => {
      const skillDir = path.join(tmpSkillsDir, "quoted-skill")
      fs.mkdirSync(skillDir, { recursive: true })
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        `---
name: quoted-skill
description: "A quoted description"
---

Body
`,
      )
      const skill = readSkill("quoted-skill")
      expect(skill!.meta.description).toBe("A quoted description")
    })
  })

  describe("skillsSystemPrompt", () => {
    it("returns empty string for no selected skills", () => {
      const prompt = skillsSystemPrompt([])
      expect(prompt).toBe("")
    })

    it("generates prompt with selected skills", () => {
      const prompt = skillsSystemPrompt(["test-skill"])
      expect(prompt).toContain("You may use these local skills")
      expect(prompt).toContain("Skill: test-skill")
      expect(prompt).toContain("Test Skill")
    })

    it("includes multiple skills", () => {
      const prompt = skillsSystemPrompt(["test-skill", "another-skill"])
      expect(prompt).toContain("Skill: test-skill")
      expect(prompt).toContain("Skill: another-skill")
    })

    it("limits to 8 skills", () => {
      // Create 10 skills
      for (let i = 0; i < 10; i++) {
        const dir = path.join(tmpSkillsDir, `skill-${i}`)
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(path.join(dir, "SKILL.md"), `# Skill ${i}`)
      }
      const names = Array.from({ length: 10 }, (_, i) => `skill-${i}`)
      const prompt = skillsSystemPrompt(names)
      // Should only include first 8
      const matches = prompt.match(/Skill: skill-\d/g) || []
      expect(matches.length).toBeLessThanOrEqual(8)
    })

    it("skips nonexistent skills gracefully", () => {
      const prompt = skillsSystemPrompt(["test-skill", "nonexistent"])
      expect(prompt).toContain("Skill: test-skill")
      expect(prompt).not.toContain("Skill: nonexistent")
    })
  })
})
