/**
 * Paths — 统一路径管理
 *
 * 从 zcode-client 的 paths.mjs 迁移，TypeScript 重写。
 * 统一管理 Dave Desktop 的所有数据目录路径，跨平台适配。
 *
 * 品牌统一：使用 ~/.dave 作为主数据目录，兼容 ~/.zcode（旧版）。
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// ─── 基础路径 ────────────────────────────────────────────

/** 用户主目录（Windows 优先 USERPROFILE，兼容 HOME） */
export function homeDir(): string {
  return process.env.USERPROFILE || process.env.HOME || os.homedir()
}

/**
 * Dave 数据根目录。
 * 优先级：DAVE_HOME 环境变量 > ~/.dave
 * 兼容：ZCODE_HOME 环境变量 > ~/.zcode（旧版，只读回退）
 */
export function daveRoot(): string {
  if (process.env.DAVE_HOME) return process.env.DAVE_HOME
  if (process.env.ZCODE_HOME) return process.env.ZCODE_HOME // 兼容旧版
  return path.join(homeDir(), ".dave")
}

/** Dave CLI 数据目录（兼容旧版 zcode cli） */
export function daveCliRoot(): string {
  return path.join(daveRoot(), "cli")
}

/** Dave v2 数据目录（兼容旧版 zcode v2） */
export function daveV2Root(): string {
  return path.join(daveRoot(), "v2")
}

/** 客户端数据根目录（Desktop 专用） */
export function clientDataRoot(): string {
  return path.join(daveRoot(), "client")
}

// ─── 数据库 ──────────────────────────────────────────────

/** SQLite 数据库路径（兼容旧版 zcode db） */
export function daveDbPath(): string {
  return path.join(daveCliRoot(), "db", "db.sqlite")
}

// ─── 配置文件 ────────────────────────────────────────────

/** 配置文件候选路径（按优先级排序） */
export function daveConfigCandidates(): string[] {
  return [
    path.join(daveCliRoot(), "config.json"),
    path.join(daveV2Root(), "config.json"),
    path.join(daveRoot(), "config.json"),
    // 项目级配置（兼容 .mimocode）
    path.join(process.cwd(), ".dave", "config.jsonc"),
    path.join(process.cwd(), ".mimocode", "mimocode.jsonc"),
  ]
}

/** 设置文件路径 */
export function daveSettingsPath(): string {
  return path.join(daveV2Root(), "setting.json")
}

// ─── 技能目录 ────────────────────────────────────────────

/**
 * 技能根目录列表（按优先级排序）。
 * 标准路径：~/.agents/skills/（Agent Skills 1.0 标准）
 * Dave 专用：~/.dave/skills/
 * 兼容旧版：~/.zcode/skills/
 */
export function daveSkillsRoots(): string[] {
  return [
    path.join(daveRoot(), "skills"),
    path.join(homeDir(), ".agents", "skills"),
    path.join(homeDir(), ".zcode", "skills"), // 兼容旧版
  ]
}

// ─── 检查点目录 ──────────────────────────────────────────

/** 检查点根目录 */
export function checkpointsRoot(): string {
  return path.join(clientDataRoot(), "checkpoints")
}

/** 单个会话的检查点目录 */
export function sessionCheckpointsDir(sessionId: string): string {
  return path.join(checkpointsRoot(), sessionId)
}

// ─── 日志目录 ────────────────────────────────────────────

/** 日志目录 */
export function logsRoot(): string {
  return path.join(clientDataRoot(), "logs")
}

// ─── 工具函数 ────────────────────────────────────────────

/**
 * 确保目录存在（递归创建），返回目录路径。
 * 与 fs.mkdirSync({ recursive: true }) 相同，但返回路径便于链式调用。
 */
export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 确保文件的父目录存在。
 */
export function ensureParentDir(filePath: string): string {
  const dir = path.dirname(filePath)
  return ensureDir(dir)
}

/**
 * 安全拼接路径，防止路径穿越。
 * 如果拼接后的路径跳出 baseDir，抛出 Error。
 */
export function safeJoin(baseDir: string, ...segments: string[]): string {
  const resolved = path.resolve(baseDir, ...segments)
  const relative = path.relative(baseDir, resolved)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path traversal detected: ${segments.join("/")}`)
  }
  return resolved
}

/**
 * 判断路径是否在某个根目录内。
 */
export function isPathWithin(childPath: string, rootPath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(childPath))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

// ─── 受信任根目录 ────────────────────────────────────────

/**
 * 获取受信任的根目录列表（用于 assertAllowedShellPath）。
 * 包括：用户主目录、Dave 数据目录、当前工作区。
 */
export function getTrustedRoots(additionalRoots: string[] = []): string[] {
  return [
    homeDir(),
    daveRoot(),
    process.cwd(),
    ...additionalRoots,
  ].filter(Boolean)
}
