/**
 * Paths Tests — 统一路径管理测试
 *
 * 覆盖 src/main/utils/paths.ts 的核心功能。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  homeDir,
  daveRoot,
  daveSkillsRoots,
  ensureDir,
  ensureParentDir,
  safeJoin,
  isPathWithin,
  getTrustedRoots,
} from "../utils/paths"

describe("homeDir", () => {
  it("returns a valid absolute path", () => {
    const dir = homeDir()
    expect(path.isAbsolute(dir)).toBe(true)
    expect(fs.existsSync(dir)).toBe(true)
  })

  it("respects USERPROFILE on Windows", () => {
    const original = process.env.USERPROFILE
    process.env.USERPROFILE = "/tmp/fake-home"
    try {
      // On non-Windows, HOME takes precedence, but USERPROFILE should be checked
      const dir = homeDir()
      expect(typeof dir).toBe("string")
    } finally {
      if (original === undefined) delete process.env.USERPROFILE
      else process.env.USERPROFILE = original
    }
  })
})

describe("daveRoot", () => {
  it("returns ~/.dave by default", () => {
    const originalDaveHome = process.env.DAVE_HOME
    const originalZcodeHome = process.env.ZCODE_HOME
    delete process.env.DAVE_HOME
    delete process.env.ZCODE_HOME
    try {
      const root = daveRoot()
      expect(root).toBe(path.join(homeDir(), ".dave"))
    } finally {
      if (originalDaveHome !== undefined) process.env.DAVE_HOME = originalDaveHome
      if (originalZcodeHome !== undefined) process.env.ZCODE_HOME = originalZcodeHome
    }
  })

  it("respects DAVE_HOME env var", () => {
    const original = process.env.DAVE_HOME
    process.env.DAVE_HOME = "/custom/dave/home"
    try {
      expect(daveRoot()).toBe("/custom/dave/home")
    } finally {
      if (original === undefined) delete process.env.DAVE_HOME
      else process.env.DAVE_HOME = original
    }
  })

  it("falls back to ZCODE_HOME for compatibility", () => {
    const originalDave = process.env.DAVE_HOME
    const originalZcode = process.env.ZCODE_HOME
    delete process.env.DAVE_HOME
    process.env.ZCODE_HOME = "/legacy/zcode"
    try {
      expect(daveRoot()).toBe("/legacy/zcode")
    } finally {
      if (originalDave !== undefined) process.env.DAVE_HOME = originalDave
      if (originalZcode === undefined) delete process.env.ZCODE_HOME
      else process.env.ZCODE_HOME = originalZcode
    }
  })
})

describe("daveSkillsRoots", () => {
  it("returns array of skill directories", () => {
    const roots = daveSkillsRoots()
    expect(Array.isArray(roots)).toBe(true)
    expect(roots.length).toBeGreaterThanOrEqual(2)
    // Should include ~/.agents/skills (standard)
    expect(roots.some((r) => r.includes(".agents"))).toBe(true)
  })

  it("all paths are absolute", () => {
    for (const root of daveSkillsRoots()) {
      expect(path.isAbsolute(root)).toBe(true)
    }
  })
})

describe("ensureDir", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dave-paths-test-"))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("creates directory recursively", () => {
    const nested = path.join(tmpDir, "a", "b", "c")
    const result = ensureDir(nested)
    expect(result).toBe(nested)
    expect(fs.existsSync(nested)).toBe(true)
    expect(fs.statSync(nested).isDirectory()).toBe(true)
  })

  it("returns existing directory without error", () => {
    const result = ensureDir(tmpDir)
    expect(result).toBe(tmpDir)
  })
})

describe("ensureParentDir", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dave-paths-test-"))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("creates parent directory for a file path", () => {
    const filePath = path.join(tmpDir, "nested", "dir", "file.txt")
    const result = ensureParentDir(filePath)
    expect(result).toBe(path.dirname(filePath))
    expect(fs.existsSync(path.dirname(filePath))).toBe(true)
  })
})

describe("safeJoin", () => {
  it("joins paths within base directory", () => {
    const base = "/home/user/project"
    const result = safeJoin(base, "src", "index.ts")
    expect(result).toBe(path.resolve(base, "src", "index.ts"))
  })

  it("rejects path traversal with ..", () => {
    expect(() => safeJoin("/home/user", "..", "etc", "passwd")).toThrow("Path traversal detected")
  })

  it("rejects absolute path segments", () => {
    expect(() => safeJoin("/home/user", "/etc/passwd")).toThrow("Path traversal detected")
  })

  it("allows same-directory reference", () => {
    const result = safeJoin("/home/user", ".", "file.txt")
    expect(result).toBe(path.resolve("/home/user", "file.txt"))
  })
})

describe("isPathWithin", () => {
  it("returns true for path inside root", () => {
    expect(isPathWithin("/home/user/project/src", "/home/user/project")).toBe(true)
  })

  it("returns true for exact root", () => {
    expect(isPathWithin("/home/user/project", "/home/user/project")).toBe(true)
  })

  it("returns false for path outside root", () => {
    expect(isPathWithin("/home/other/project", "/home/user/project")).toBe(false)
  })

  it("returns false for parent directory", () => {
    expect(isPathWithin("/home/user", "/home/user/project")).toBe(false)
  })

  it("resolves relative paths", () => {
    expect(isPathWithin("src/index.ts", process.cwd())).toBe(true)
  })
})

describe("getTrustedRoots", () => {
  it("includes home directory and cwd", () => {
    const roots = getTrustedRoots()
    expect(roots).toContain(homeDir())
    expect(roots).toContain(process.cwd())
  })

  it("includes additional roots", () => {
    const extra = "/extra/trusted/path"
    const roots = getTrustedRoots([extra])
    expect(roots).toContain(extra)
  })

  it("all roots are absolute paths", () => {
    for (const root of getTrustedRoots()) {
      expect(path.isAbsolute(root)).toBe(true)
    }
  })
})
