/**
 * Checkpoints Tests — 会话检查点测试
 *
 * 覆盖 src/main/session/checkpoints.ts 的核心功能。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  createCheckpoint,
  listCheckpoints,
  getCheckpoint,
  previewRewind,
  markDirty,
  consumeDirty,
} from "../session/checkpoints"

describe("checkpoints", () => {
  let tmpWorkspace: string
  const sessionId = "test-session-123"

  beforeEach(() => {
    tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "dave-cp-test-"))
    // 创建一个测试文件
    fs.writeFileSync(path.join(tmpWorkspace, "hello.txt"), "hello world")
  })

  afterEach(() => {
    fs.rmSync(tmpWorkspace, { recursive: true, force: true })
  })

  describe("createCheckpoint", () => {
    it("creates a checkpoint with file snapshot", async () => {
      const cp = await createCheckpoint(sessionId, {
        workspace: tmpWorkspace,
        files: ["hello.txt"],
        label: "test checkpoint",
      })
      expect(cp.id).toMatch(/^cp_/)
      expect(cp.sessionId).toBe(sessionId)
      expect(cp.label).toBe("test checkpoint")
      expect(cp.kind).toBe("files")
      expect(cp.fileCount).toBe(1)
      expect(cp.files["hello.txt"]).toBe("hello world")
    })

    it("generates unique IDs", async () => {
      const cp1 = await createCheckpoint(sessionId, { workspace: tmpWorkspace, files: ["hello.txt"] })
      const cp2 = await createCheckpoint(sessionId, { workspace: tmpWorkspace, files: ["hello.txt"] })
      expect(cp1.id).not.toBe(cp2.id)
    })

    it("defaults label to ISO timestamp", async () => {
      const cp = await createCheckpoint(sessionId, { workspace: tmpWorkspace, files: ["hello.txt"] })
      expect(cp.label).toContain("checkpoint")
    })

    it("handles empty file list", async () => {
      const cp = await createCheckpoint(sessionId, { workspace: tmpWorkspace, files: [] })
      expect(cp.fileCount).toBe(0)
      expect(cp.files).toEqual({})
    })

    it("skips non-existent files", async () => {
      const cp = await createCheckpoint(sessionId, {
        workspace: tmpWorkspace,
        files: ["hello.txt", "nonexistent.txt"],
      })
      expect(cp.fileCount).toBe(1)
      expect(cp.files["hello.txt"]).toBe("hello world")
      expect(cp.files["nonexistent.txt"]).toBeUndefined()
    })
  })

  describe("listCheckpoints", () => {
    it("returns empty array for new session", () => {
      const result = listCheckpoints("nonexistent-session")
      expect(result).toEqual([])
    })

    it("returns checkpoints in reverse chronological order", async () => {
      await createCheckpoint(sessionId, { workspace: tmpWorkspace, files: ["hello.txt"], label: "first" })
      await createCheckpoint(sessionId, { workspace: tmpWorkspace, files: ["hello.txt"], label: "second" })
      const list = listCheckpoints(sessionId)
      expect(list).toHaveLength(2)
      expect(list[0].label).toBe("second")
      expect(list[1].label).toBe("first")
    })

    it("includes id, label, timeCreated, fileCount", async () => {
      await createCheckpoint(sessionId, { workspace: tmpWorkspace, files: ["hello.txt"], label: "test" })
      const list = listCheckpoints(sessionId)
      expect(list[0]).toHaveProperty("id")
      expect(list[0]).toHaveProperty("label")
      expect(list[0]).toHaveProperty("timeCreated")
      expect(list[0]).toHaveProperty("fileCount")
      expect(list[0].fileCount).toBe(1)
    })
  })

  describe("getCheckpoint", () => {
    it("returns null for nonexistent checkpoint", () => {
      const result = getCheckpoint(sessionId, "cp_nonexistent")
      expect(result).toBeNull()
    })

    it("returns full checkpoint details", async () => {
      const created = await createCheckpoint(sessionId, {
        workspace: tmpWorkspace,
        files: ["hello.txt"],
        label: "detail test",
      })
      const fetched = getCheckpoint(sessionId, created.id)
      expect(fetched).not.toBeNull()
      expect(fetched!.id).toBe(created.id)
      expect(fetched!.label).toBe("detail test")
      expect(fetched!.files["hello.txt"]).toBe("hello world")
    })
  })

  describe("previewRewind", () => {
    it("throws for nonexistent checkpoint", () => {
      expect(() => previewRewind(sessionId, "cp_nonexistent")).toThrow("checkpoint not found")
    })

    it("returns empty changes when files match", async () => {
      const cp = await createCheckpoint(sessionId, {
        workspace: tmpWorkspace,
        files: ["hello.txt"],
      })
      const preview = previewRewind(sessionId, cp.id)
      expect(preview.changeCount).toBe(0)
      expect(preview.changes).toEqual([])
    })

    it("detects modified files", async () => {
      const cp = await createCheckpoint(sessionId, {
        workspace: tmpWorkspace,
        files: ["hello.txt"],
      })
      fs.writeFileSync(path.join(tmpWorkspace, "hello.txt"), "modified content")
      const preview = previewRewind(sessionId, cp.id)
      expect(preview.changeCount).toBe(1)
      expect(preview.changes[0].path).toBe("hello.txt")
      expect(preview.changes[0].action).toBe("modify")
    })

    it("includes before/after previews", async () => {
      const cp = await createCheckpoint(sessionId, {
        workspace: tmpWorkspace,
        files: ["hello.txt"],
      })
      fs.writeFileSync(path.join(tmpWorkspace, "hello.txt"), "new content")
      const preview = previewRewind(sessionId, cp.id)
      expect(preview.changes[0].beforePreview).toContain("new content")
      expect(preview.changes[0].afterPreview).toContain("hello world")
    })
  })

  describe("dirty file tracking", () => {
    it("tracks and consumes dirty files", () => {
      markDirty(sessionId, tmpWorkspace, "src/file1.ts")
      markDirty(sessionId, tmpWorkspace, "src/file2.ts")
      const dirty = consumeDirty(sessionId)
      expect(dirty).toContain("src/file1.ts")
      expect(dirty).toContain("src/file2.ts")
      expect(dirty).toHaveLength(2)
    })

    it("consume clears the dirty set", () => {
      markDirty(sessionId, tmpWorkspace, "file.ts")
      consumeDirty(sessionId)
      const dirty = consumeDirty(sessionId)
      expect(dirty).toEqual([])
    })

    it("ignores paths outside workspace", () => {
      markDirty(sessionId, tmpWorkspace, "../../etc/passwd")
      const dirty = consumeDirty(sessionId)
      expect(dirty).toEqual([])
    })

    it("normalizes path separators", () => {
      markDirty(sessionId, tmpWorkspace, "src\\nested\\file.ts")
      const dirty = consumeDirty(sessionId)
      expect(dirty[0]).toBe("src/nested/file.ts")
    })
  })
})
