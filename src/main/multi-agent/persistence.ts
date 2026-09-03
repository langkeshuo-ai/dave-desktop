/**
 * Multi-Agent Collaboration Persistence — 协作状态持久化
 *
 * 将协作状态保存到工作区的 .dave/collaborations/ 目录，
 * 支持列出历史协作、加载恢复、删除。
 *
 * 文件命名：<timestamp>-<slug>.json
 */
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { existsSync } from "node:fs"
import log from "electron-log"
import { getStore } from "../store"
import type { CollaborationState } from "./types"

const COLLAB_DIR = ".dave/collaborations"

export interface CollaborationSummary {
  id: string
  goal: string
  stage: string
  taskCount: number
  completedTasks: number
  startedAt: number
  completedAt?: number
  filename: string
}

function getCollabDir(): string | null {
  const workspace = (getStore().get("cwd") as string) || ""
  if (!workspace) return null
  return join(workspace, COLLAB_DIR)
}

function slugify(text: string): string {
  return text
    .slice(0, 40)
    .replace(/[^\w\u4e00-\u9fa5]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
}

/**
 * 保存协作状态到工作区。
 * 返回保存的文件路径。
 */
export async function saveCollaboration(state: CollaborationState): Promise<string | null> {
  try {
    const dir = getCollabDir()
    if (!dir) return null

    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }

    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")
    const slug = slugify(state.goal || "untitled")
    const filename = `${timestamp}-${slug}.json`
    const filepath = join(dir, filename)

    const data = JSON.stringify(state, null, 2)
    await writeFile(filepath, data, "utf-8")
    log.info(`[multi-agent] collaboration saved: ${filepath}`)
    return filepath
  } catch (err) {
    log.warn(
      "[multi-agent] saveCollaboration failed:",
      err instanceof Error ? err.message : String(err),
    )
    return null
  }
}

/**
 * 列出所有保存的协作（按时间倒序）。
 */
export async function listCollaborations(): Promise<CollaborationSummary[]> {
  try {
    const dir = getCollabDir()
    if (!dir || !existsSync(dir)) return []

    const files = await readdir(dir)
    const jsonFiles = files
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse()

    const summaries: CollaborationSummary[] = []
    for (const filename of jsonFiles.slice(0, 50)) {
      try {
        const filepath = join(dir, filename)
        const content = await readFile(filepath, "utf-8")
        const state = JSON.parse(content) as CollaborationState
        summaries.push({
          id: state.sessionId,
          goal: state.goal,
          stage: state.stage,
          taskCount: state.tasks.length,
          completedTasks: state.tasks.filter((t) => t.status === "completed").length,
          startedAt: state.startedAt,
          completedAt: state.completedAt,
          filename,
        })
      } catch {
        // 跳过损坏的文件
      }
    }

    return summaries
  } catch (err) {
    log.warn(
      "[multi-agent] listCollaborations failed:",
      err instanceof Error ? err.message : String(err),
    )
    return []
  }
}

/**
 * 加载指定的协作状态。
 */
export async function loadCollaboration(filename: string): Promise<CollaborationState | null> {
  try {
    const dir = getCollabDir()
    if (!dir) return null

    // 安全检查：防止路径遍历
    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      return null
    }

    const filepath = join(dir, filename)
    if (!existsSync(filepath)) return null

    const content = await readFile(filepath, "utf-8")
    return JSON.parse(content) as CollaborationState
  } catch (err) {
    log.warn(
      "[multi-agent] loadCollaboration failed:",
      err instanceof Error ? err.message : String(err),
    )
    return null
  }
}

/**
 * 删除指定的协作记录。
 */
export async function deleteCollaboration(filename: string): Promise<boolean> {
  try {
    const dir = getCollabDir()
    if (!dir) return false

    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      return false
    }

    const filepath = join(dir, filename)
    if (!existsSync(filepath)) return false

    await unlink(filepath)
    return true
  } catch (err) {
    log.warn(
      "[multi-agent] deleteCollaboration failed:",
      err instanceof Error ? err.message : String(err),
    )
    return false
  }
}
