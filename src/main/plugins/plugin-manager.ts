/**
 * Plugin Manager — 插件管理器
 *
 * 从 zcode-client 的 plugins.mjs 设计迁移，TypeScript 实现。
 * 提供插件发现、加载、卸载、生命周期管理能力。
 *
 * 插件格式：
 * - 目录：~/.dave/plugins/<plugin-name>/
 * - 入口：plugin.json（元数据）+ index.js 或 index.ts（主逻辑）
 * - 插件通过 IPC channel 与主进程通信
 *
 * 安全设计：
 * - 插件运行在独立的子进程中（sandbox）
 * - 插件只能访问声明的权限
 * - 插件 IPC 通信经过权限校验
 */
import fs from "node:fs"
import path from "node:path"
import { EventEmitter } from "node:events"
import { daveRoot, ensureDir, safeJoin } from "../utils/paths"

// ─── 类型 ────────────────────────────────────────────────

export type PluginStatus = "installed" | "loading" | "running" | "stopped" | "error"

export interface PluginManifest {
  name: string
  version: string
  description?: string
  author?: string
  main: string
  permissions: string[]
  contributes?: {
    ipcChannels?: string[]
    commands?: string[]
    settings?: Record<string, unknown>
  }
}

export interface PluginInfo {
  name: string
  version: string
  description: string
  author: string
  status: PluginStatus
  path: string
  manifest: PluginManifest
  error?: string
  loadedAt?: number
}

export interface PluginManagerOptions {
  /** 插件目录，默认 ~/.dave/plugins */
  pluginDir?: string
  /** 自动加载已启用的插件 */
  autoLoad?: boolean
}

// ─── 插件管理器 ──────────────────────────────────────────

export class PluginManager extends EventEmitter {
  private pluginDir: string
  private plugins = new Map<string, PluginInfo>()
  private autoLoad: boolean

  constructor(options: PluginManagerOptions = {}) {
    super()
    this.pluginDir = options.pluginDir || path.join(daveRoot(), "plugins")
    this.autoLoad = options.autoLoad ?? false
  }

  /** 获取插件目录 */
  getPluginDir(): string {
    return this.pluginDir
  }

  /** 确保插件目录存在 */
  ensurePluginDir(): string {
    return ensureDir(this.pluginDir)
  }

  /**
   * 扫描插件目录，发现所有已安装的插件。
   * 读取每个插件的 plugin.json 清单。
   */
  discoverPlugins(): PluginInfo[] {
    this.ensurePluginDir()
    if (!fs.existsSync(this.pluginDir)) return []

    const result: PluginInfo[] = []
    for (const ent of fs.readdirSync(this.pluginDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue
      if (ent.name.startsWith(".")) continue

      const pluginPath = path.join(this.pluginDir, ent.name)
      const manifestPath = path.join(pluginPath, "plugin.json")

      if (!fs.existsSync(manifestPath)) continue

      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as PluginManifest
        const info: PluginInfo = {
          name: manifest.name || ent.name,
          version: manifest.version || "0.0.0",
          description: manifest.description || "",
          author: manifest.author || "",
          status: "installed",
          path: pluginPath,
          manifest,
        }
        this.plugins.set(info.name, info)
        result.push(info)
      } catch (err) {
        const info: PluginInfo = {
          name: ent.name,
          version: "0.0.0",
          description: "",
          author: "",
          status: "error",
          path: pluginPath,
          manifest: { name: ent.name, version: "0.0.0", main: "", permissions: [] },
          error: String(err),
        }
        this.plugins.set(ent.name, info)
        result.push(info)
      }
    }

    return result.sort((a, b) => a.name.localeCompare(b.name))
  }

  /** 获取所有插件信息 */
  listPlugins(): PluginInfo[] {
    return [...this.plugins.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  /** 获取单个插件信息 */
  getPlugin(name: string): PluginInfo | undefined {
    return this.plugins.get(name)
  }

  /**
   * 加载插件（读取清单 + 标记为 loading）。
   * 实际的插件代码执行由 PluginRunner 处理（需要 sandbox 子进程）。
   */
  loadPlugin(name: string): PluginInfo {
    const plugin = this.plugins.get(name)
    if (!plugin) throw new Error(`Plugin not found: ${name}`)
    if (plugin.status === "running") return plugin

    plugin.status = "loading"
    plugin.loadedAt = Date.now()
    this.emit("plugin:loading", plugin)

    // 验证入口文件存在
    const mainPath = safeJoin(plugin.path, plugin.manifest.main)
    if (!fs.existsSync(mainPath)) {
      plugin.status = "error"
      plugin.error = `Main file not found: ${plugin.manifest.main}`
      this.emit("plugin:error", plugin)
      return plugin
    }

    plugin.status = "stopped" // 已加载但未运行
    this.emit("plugin:loaded", plugin)
    return plugin
  }

  /**
   * 卸载插件（标记为 stopped，清除运行时状态）。
   */
  unloadPlugin(name: string): boolean {
    const plugin = this.plugins.get(name)
    if (!plugin) return false
    plugin.status = "stopped"
    this.emit("plugin:unloaded", plugin)
    return true
  }

  /**
   * 检查插件是否有权限执行某个操作。
   */
  hasPermission(pluginName: string, permission: string): boolean {
    const plugin = this.plugins.get(pluginName)
    if (!plugin) return false
    return plugin.manifest.permissions.includes(permission) || plugin.manifest.permissions.includes("*")
  }

  /**
   * 检查插件是否可以注册某个 IPC channel。
   * 插件只能注册在 manifest.contributes.ipcChannels 中声明的 channel。
   */
  canRegisterIpcChannel(pluginName: string, channel: string): boolean {
    const plugin = this.plugins.get(pluginName)
    if (!plugin) return false
    const channels = plugin.manifest.contributes?.ipcChannels || []
    return channels.includes(channel) || channels.includes("*")
  }

  /** 获取所有运行中的插件 */
  getRunningPlugins(): PluginInfo[] {
    return this.listPlugins().filter((p) => p.status === "running")
  }

  /** 获取管理器状态（用于诊断） */
  getStatus(): Record<string, unknown> {
    return {
      pluginDir: this.pluginDir,
      pluginDirExists: fs.existsSync(this.pluginDir),
      totalPlugins: this.plugins.size,
      running: this.getRunningPlugins().length,
      byStatus: this.listPlugins().reduce((acc, p) => {
        acc[p.status] = (acc[p.status] || 0) + 1
        return acc
      }, {} as Record<string, number>),
    }
  }
}

// ─── 单例 ─────────────────────────────────────────────────

let defaultManager: PluginManager | null = null

/** 获取默认的 PluginManager 单例 */
export function getPluginManager(): PluginManager {
  if (!defaultManager) {
    defaultManager = new PluginManager()
  }
  return defaultManager
}
