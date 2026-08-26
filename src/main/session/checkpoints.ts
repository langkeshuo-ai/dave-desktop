/**
 * Checkpoints — 会话检查点管理
 *
 * 从 zcode-client 的 checkpoints.mjs 迁移，TypeScript 重写。
 * 提供会话状态快照、回滚、级联回滚能力。
 *
 * 核心能力：
 * 1. createCheckpoint — 创建检查点（git stash + 文件快照）
 * 2. listCheckpoints — 列出会话所有检查点
 * 3. getCheckpoint — 获取单个检查点详情
 * 4. previewRewind — 预览回滚会改变哪些文件
 * 5. applyRewind — 执行回滚（自动创建安全检查点）
 * 6. rewindCascade — 级联回滚（回滚后删除更新的检查点）
 * 7. markDirty / consumeDirty — 跟踪文件变更，自动包含到下一个检查点
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import { clientDataRoot, ensureDir } from "../utils/paths"

// ─── 类型 ────────────────────────────────────────────────

export interface GitInfo {
  head: string | null
  stashRef: string | null
  diff: string
  untracked: string[]
}

export interface Checkpoint {
  id: string
  sessionId: string
  label: string
  timeCreated: number
  workspace: string
  kind: "files" | "git+files"
  git: GitInfo | null
  files: Record<string, string>
  fileCount: number
}

export interface CheckpointSummary {
  id: string
  label: string
  timeCreated: number
  fileCount: number
  kind: string
  gitHead: string | null
}

export interface CheckpointIndex {
  sessionId: string
  checkpoints: CheckpointSummary[]
}

export interface RewindChange {
  path: string
  action: "create" | "modify"
  beforeBytes: number
  afterBytes: number
  beforePreview: string | null
  afterPreview: string
}

export interface RewindPreview {
  checkpointId: string
  sessionId: string
  kind: string
  git: GitInfo | null
  changes: RewindChange[]
  changeCount: number
}

export interface RewindResult {
  ok: boolean
  applied: string
  safetyCheckpointId: string
  changeCount: number
  changes: RewindChange[]
  gitApplied: boolean
  kind: string
}

export interface CascadeResult extends RewindResult {
  cascade: true
  remainingCheckpoints: CheckpointSummary[]
}

export interface CreateCheckpointOptions {
  workspace?: string
  files?: string[]
  label?: string
}

// ─── 路径工具 ────────────────────────────────────────────

function rootDir(): string {
  return ensureDir(path.join(clientDataRoot(), "checkpoints"))
}

function sessionDir(sessionId: string): string {
  return ensureDir(path.join(rootDir(), sessionId))
}

function indexPath(sessionId: string): string {
  return path.join(sessionDir(sessionId), "index.json")
}

// ─── 索引读写 ────────────────────────────────────────────

function readIndex(sessionId: string): CheckpointIndex {
  const f = indexPath(sessionId)
  if (!fs.existsSync(f)) return { sessionId, checkpoints: [] }
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")) as CheckpointIndex
  } catch {
    return { sessionId, checkpoints: [] }
  }
}

function writeIndex(sessionId: string, idx: CheckpointIndex): void {
  fs.writeFileSync(indexPath(sessionId), JSON.stringify(idx, null, 2), "utf8")
}

// ─── Git 工具 ─────────────────────────────────────────────

interface GitResult {
  code: number
  stdout: string
  stderr: string
}

function runGit(args: string[], cwd: string): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd,
      env: process.env,
      windowsHide: true,
      shell: false,
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (d) => (stdout += d.toString("utf8")))
    child.stderr.on("data", (d) => (stderr += d.toString("utf8")))
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

async function isGitRepo(workspace: string): Promise<boolean> {
  const r = await runGit(["rev-parse", "--is-inside-work-tree"], workspace)
  return r.code === 0 && r.stdout.trim() === "true"
}

async function gitChangedFiles(workspace: string): Promise<string[]> {
  const r = await runGit(["status", "--porcelain"], workspace)
  if (r.code !== 0) return []
  return r.stdout
    .split(/\r?\n/)
    .map((l) => l.replace(/^\?\? /, "").replace(/^.. /, "").trim())
    .filter(Boolean)
    .slice(0, 200)
}

// ─── 文件快照 ─────────────────────────────────────────────

function snapshotFiles(workspace: string, relPaths: string[] = []): Record<string, string> {
  const out: Record<string, string> = {}
  const root = path.resolve(workspace)
  for (const rel of relPaths) {
    try {
      const abs = path.resolve(workspace, rel)
      if (!abs.startsWith(root)) continue
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue
      out[rel.replace(/\\/g, "/")] = fs.readFileSync(abs, "utf8")
    } catch {
      // skip unreadable files
    }
  }
  return out
}

// ─── 核心 API ─────────────────────────────────────────────

/**
 * 创建检查点。
 * 如果工作区是 git 仓库，自动创建 stash 并记录 HEAD；
 * 同时快照所有变更文件的内容。
 */
export async function createCheckpoint(
  sessionId: string,
  options: CreateCheckpointOptions = {},
): Promise<Checkpoint> {
  const id = `cp_${crypto.randomUUID()}`
  const now = Date.now()
  const ws = options.workspace || process.cwd()
  let kind: "files" | "git+files" = "files"
  let git: GitInfo | null = null
  let fileList = options.files || []

  if (await isGitRepo(ws)) {
    kind = "git+files"
    if (!fileList.length) fileList = await gitChangedFiles(ws)

    const head = await runGit(["rev-parse", "HEAD"], ws)
    const stash = await runGit(["stash", "create", `dave-checkpoint-${id}`], ws)
    git = {
      head: head.code === 0 ? head.stdout.trim() : null,
      stashRef: stash.code === 0 && stash.stdout.trim() ? stash.stdout.trim() : null,
      diff: "",
      untracked: [],
    }

    const diff = await runGit(["diff", "HEAD"], ws)
    const untracked = await runGit(["ls-files", "--others", "--exclude-standard"], ws)
    git.diff = diff.code === 0 ? diff.stdout : ""
    git.untracked = untracked.code === 0 ? untracked.stdout.split(/\r?\n/).filter(Boolean) : []
  }

  const snaps = snapshotFiles(ws, fileList)
  const file = path.join(sessionDir(sessionId), `${id}.json`)
  const payload: Checkpoint = {
    id,
    sessionId,
    label: options.label || `checkpoint ${new Date(now).toISOString()}`,
    timeCreated: now,
    workspace: ws,
    kind,
    git,
    files: snaps,
    fileCount: Object.keys(snaps).length,
  }
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8")

  const idx = readIndex(sessionId)
  idx.checkpoints.unshift({
    id,
    label: payload.label,
    timeCreated: now,
    fileCount: payload.fileCount,
    kind,
    gitHead: git?.head || null,
  })
  writeIndex(sessionId, idx)

  return payload
}

/** 列出会话所有检查点（按时间倒序） */
export function listCheckpoints(sessionId: string): CheckpointSummary[] {
  return readIndex(sessionId).checkpoints
}

/** 获取单个检查点详情 */
export function getCheckpoint(sessionId: string, checkpointId: string): Checkpoint | null {
  const file = path.join(sessionDir(sessionId), `${checkpointId}.json`)
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, "utf8")) as Checkpoint
}

/**
 * 预览回滚会改变哪些文件（不实际修改）。
 * 返回每个文件的 before/after 预览和字节数。
 */
export function previewRewind(sessionId: string, checkpointId: string): RewindPreview {
  const cp = getCheckpoint(sessionId, checkpointId)
  if (!cp) throw new Error(`checkpoint not found: ${checkpointId}`)

  const changes: RewindChange[] = []
  for (const [rel, content] of Object.entries(cp.files || {})) {
    const abs = path.resolve(cp.workspace, rel)
    let current: string | null = null
    try {
      current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null
    } catch {
      current = null
    }
    if (current !== content) {
      changes.push({
        path: rel,
        action: current == null ? "create" : "modify",
        beforeBytes: current == null ? 0 : Buffer.byteLength(current, "utf8"),
        afterBytes: Buffer.byteLength(content, "utf8"),
        beforePreview: current == null ? null : current.slice(0, 400),
        afterPreview: content.slice(0, 400),
      })
    }
  }

  return {
    checkpointId,
    sessionId,
    kind: cp.kind,
    git: cp.git || null,
    changes,
    changeCount: changes.length,
  }
}

/**
 * 执行回滚。
 * 自动先创建一个安全检查点（pre-rewind-safety），然后应用回滚。
 * 如果有 git HEAD，优先 git reset --hard，再应用文件快照。
 */
export async function applyRewind(sessionId: string, checkpointId: string): Promise<RewindResult> {
  const cp = getCheckpoint(sessionId, checkpointId)
  if (!cp) throw new Error(`checkpoint not found: ${checkpointId}`)

  const preview = previewRewind(sessionId, checkpointId)

  // 自动创建安全检查点
  const safety = await createCheckpoint(sessionId, {
    workspace: cp.workspace,
    files: Object.keys(cp.files || {}),
    label: `pre-rewind-safety ${checkpointId}`,
  })

  // 优先 git reset
  let gitApplied = false
  if (cp.git?.head && (await isGitRepo(cp.workspace))) {
    const reset = await runGit(["reset", "--hard", cp.git.head], cp.workspace)
    gitApplied = reset.code === 0
    if (cp.git.stashRef) {
      await runGit(["stash", "apply", cp.git.stashRef], cp.workspace)
    }
  }

  // 应用文件快照
  for (const [rel, content] of Object.entries(cp.files || {})) {
    const abs = path.resolve(cp.workspace, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content, "utf8")
  }

  return {
    ok: true,
    applied: checkpointId,
    safetyCheckpointId: safety.id,
    changeCount: preview.changeCount,
    changes: preview.changes,
    gitApplied,
    kind: cp.kind,
  }
}

/**
 * 级联回滚。
 * 回滚到指定检查点后，删除所有比它更新的检查点。
 */
export async function rewindCascade(sessionId: string, checkpointId: string): Promise<CascadeResult> {
  const result = await applyRewind(sessionId, checkpointId)
  const all = listCheckpoints(sessionId)
  const idx = all.findIndex((c) => c.id === checkpointId)

  if (idx > 0) {
    const drop = all.slice(0, idx)
    const keep = all.slice(idx)
    for (const d of drop) {
      const f = path.join(sessionDir(sessionId), `${d.id}.json`)
      if (fs.existsSync(f)) fs.rmSync(f, { force: true })
    }
    writeIndex(sessionId, { sessionId, checkpoints: keep })
  }

  return {
    ...result,
    cascade: true,
    remainingCheckpoints: listCheckpoints(sessionId),
  }
}

// ─── Dirty 文件跟踪 ──────────────────────────────────────

const dirtyFiles = new Map<string, Set<string>>()

/** 标记一个文件为脏（将被包含到下一个检查点） */
export function markDirty(sessionId: string, workspace: string, absOrRelPath: string): void {
  if (!sessionId) return
  const ws = path.resolve(workspace || process.cwd())
  const abs = path.resolve(ws, absOrRelPath)
  const rel = path.relative(ws, abs).replace(/\\/g, "/")
  if (rel.startsWith("..")) return
  if (!dirtyFiles.has(sessionId)) dirtyFiles.set(sessionId, new Set())
  dirtyFiles.get(sessionId)!.add(rel)
}

/** 消费并清除脏文件列表（返回相对路径数组） */
export function consumeDirty(sessionId: string): string[] {
  const set = dirtyFiles.get(sessionId)
  dirtyFiles.delete(sessionId)
  return set ? [...set] : []
}
