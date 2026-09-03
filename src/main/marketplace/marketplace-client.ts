/**
 * Marketplace Client — 技能/插件市场客户端
 *
 * 从 zcode-client 的 marketplace.mjs 迁移，TypeScript 重写，Dave 品牌。
 *
 * 核心能力：
 * 1. listMarketplaces — 列出所有已配置的市场目录
 * 2. listInstalledPlugins — 列出已安装的插件
 * 3. installPlugin — 从市场安装插件（本地复制 / git clone / 创建 stub）
 * 4. uninstallPlugin — 卸载插件
 * 5. updateMarketplace — 更新市场目录（git pull / clone）
 * 6. describePlugin — 获取插件详情（已安装或市场中）
 *
 * 安全设计：
 * - 插件安装到缓存目录，不直接写入系统目录
 * - git clone 使用 --depth 1（浅克隆）
 * - 安装时排除 .git 和 node_modules
 * - 市场源使用 HTTPS GitHub 仓库
 */
import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import { daveCliRoot, ensureDir } from "../utils/paths"

// ─── 类型 ────────────────────────────────────────────────

export interface MarketplaceCatalog {
  id: string
  name: string
  description: string
  pluginCount: number
  path: string
  plugins: CatalogPlugin[]
}

export interface CatalogPlugin {
  name: string
  description: string
  version: string
  source: PluginSource | null
  category: string | null
}

export interface PluginSource {
  source: "local" | "url" | "github"
  url?: string
  repo?: string
  sha?: string
  [key: string]: unknown
}

export interface MarketplaceManifest {
  name?: string
  description?: string
  plugins?: CatalogPlugin[]
  [key: string]: unknown
}

export interface KnownMarketplace {
  id: string
  source: PluginSource
  name: string
  description: string
  addedAt: string
  pluginCount: number
  lastUpdated: string
}

export interface KnownMarketplacesFile {
  version: number
  marketplaces: KnownMarketplace[]
}

export interface InstalledPlugin {
  id: string
  name: string
  marketplace: string
  version: string
  installPath: string
  installedAt: string
  updatedAt: string
  scope: "user" | "project"
  source: string | PluginSource
}

export interface InstalledPluginsFile {
  version: number
  plugins: InstalledPlugin[]
}

export interface InstallOptions {
  marketplace?: string
  name: string
  version?: string
}

export interface UninstallOptions {
  marketplace?: string
  name: string
}

export interface PluginDescription {
  installed: boolean
  name: string
  marketplace?: string
  version?: string
  description?: string
  installPath?: string
  installedAt?: string
  manifest?: Record<string, unknown>
  source?: string | PluginSource
  category?: string | null
}

// ─── 工具函数 ────────────────────────────────────────────

function readJson<T>(file: string, fallback: T | null = null): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8")
}

function marketplacesRoot(): string {
  return path.join(daveCliRoot(), "plugins", "marketplaces")
}

function cacheRoot(): string {
  return path.join(daveCliRoot(), "plugins", "cache")
}

function installedPath(): string {
  return path.join(daveCliRoot(), "plugins", "installed_plugins.json")
}

function knownPath(): string {
  return path.join(daveCliRoot(), "plugins", "known_marketplaces.json")
}

function cpRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (ent.name === ".git" || ent.name === "node_modules") continue
    const s = path.join(src, ent.name)
    const d = path.join(dest, ent.name)
    if (ent.isDirectory()) cpRecursive(s, d)
    else fs.copyFileSync(s, d)
  }
}

function run(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: process.env,
      windowsHide: true,
      shell: false,
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (d) => (stdout += d.toString("utf8")))
    child.stderr.on("data", (d) => (stderr += d.toString("utf8")))
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${cmd} ${args.join(" ")} failed (${code}): ${stderr || stdout}`))
    })
  })
}

// ─── 核心 API ─────────────────────────────────────────────

/** 列出所有市场目录及其插件 */
export function listMarketplaces(): {
  known: KnownMarketplacesFile
  catalogs: MarketplaceCatalog[]
} {
  const known = readJson<KnownMarketplacesFile>(knownPath(), { version: 1, marketplaces: [] }) || {
    version: 1,
    marketplaces: [],
  }
  const catalogs: MarketplaceCatalog[] = []
  const root = marketplacesRoot()
  if (fs.existsSync(root)) {
    for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue
      const mp = path.join(root, ent.name, "marketplace.json")
      const alt = path.join(root, ent.name, ".dave-plugin", "marketplace.json")
      const file = fs.existsSync(mp) ? mp : fs.existsSync(alt) ? alt : null
      if (!file) continue
      const cat = readJson<MarketplaceManifest>(file)
      if (!cat) continue
      catalogs.push({
        id: ent.name,
        name: cat.name || ent.name,
        description: cat.description || "",
        pluginCount: Array.isArray(cat.plugins) ? cat.plugins.length : 0,
        path: path.dirname(file),
        plugins: (cat.plugins || []).map((p) => ({
          name: p.name,
          description: p.description || "",
          version: p.version || "0.0.0",
          source: p.source || null,
          category: p.category || null,
        })),
      })
    }
  }
  return { known, catalogs }
}

/** 列出已安装的插件 */
export function listInstalledPlugins(): InstalledPluginsFile {
  return (
    readJson<InstalledPluginsFile>(installedPath(), { version: 1, plugins: [] }) || {
      version: 1,
      plugins: [],
    }
  )
}

function findCatalogPlugin(
  marketplaceId: string,
  pluginName: string,
): { cat: MarketplaceCatalog; plugin: CatalogPlugin | undefined; sourceDir: string | null } {
  const { catalogs } = listMarketplaces()
  const cat = catalogs.find((c) => c.id === marketplaceId || c.name === marketplaceId)
  if (!cat) throw new Error(`marketplace not found: ${marketplaceId}`)
  const plugin = (cat.plugins || []).find((p) => p.name === pluginName)
  const localPluginDir = path.join(cat.path, "plugins", pluginName)
  const externalDir = path.join(cat.path, "external_plugins", pluginName)
  let sourceDir: string | null = null
  if (fs.existsSync(localPluginDir)) sourceDir = localPluginDir
  else if (fs.existsSync(externalDir)) sourceDir = externalDir
  return { cat, plugin, sourceDir }
}

/**
 * 从市场安装插件。
 * 支持三种安装方式：
 * 1. 本地复制（市场目录中有插件源码）
 * 2. git clone（插件 source 为 url）
 * 3. 创建 stub（只有元数据，没有源码）
 */
export async function installPlugin(options: InstallOptions): Promise<InstalledPlugin> {
  const { marketplace = "dave-plugins-official", name, version = "0.0.0" } = options
  if (!name) throw new Error("plugin name required")
  const { cat, plugin, sourceDir } = findCatalogPlugin(marketplace, name)
  const ver = plugin?.version || version || "0.0.0"
  const installPath = path.join(cacheRoot(), cat.id, name, ver)
  ensureDir(path.dirname(installPath))

  if (sourceDir) {
    if (fs.existsSync(installPath)) fs.rmSync(installPath, { recursive: true, force: true })
    cpRecursive(sourceDir, installPath)
  } else if (plugin?.source?.source === "url" && plugin.source.url) {
    if (fs.existsSync(installPath)) fs.rmSync(installPath, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(installPath), { recursive: true })
    const tmp = `${installPath}.tmp`
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true })
    await run("git", ["clone", "--depth", "1", plugin.source.url, tmp], path.dirname(tmp))
    if (plugin.source.sha) {
      try {
        await run("git", ["fetch", "--depth", "1", "origin", plugin.source.sha], tmp)
        await run("git", ["checkout", plugin.source.sha], tmp)
      } catch {
        // keep default branch if sha fetch fails
      }
    }
    fs.renameSync(tmp, installPath)
  } else {
    fs.mkdirSync(installPath, { recursive: true })
    writeJson(path.join(installPath, "plugin.json"), {
      name,
      version: ver,
      description: plugin?.description || "",
      marketplace: cat.id,
    })
    writeJson(path.join(installPath, "package.json"), {
      name,
      version: ver,
      private: true,
      description: plugin?.description || "",
    })
  }

  const installed = listInstalledPlugins()
  const id = `${name}@${cat.id}`
  const entry: InstalledPlugin = {
    id,
    name,
    marketplace: cat.id,
    version: ver,
    installPath,
    installedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    scope: "user",
    source: plugin?.source || `./plugins/${name}`,
  }
  installed.plugins = (installed.plugins || []).filter(
    (p) => p.id !== id && !(p.name === name && p.marketplace === cat.id),
  )
  installed.plugins.unshift(entry)
  installed.version = installed.version || 1
  writeJson(installedPath(), installed)
  return entry
}

/** 卸载插件 */
export function uninstallPlugin(options: UninstallOptions): {
  ok: boolean
  uninstalled: InstalledPlugin
} {
  const { marketplace, name } = options
  const installed = listInstalledPlugins()
  const hit = (installed.plugins || []).find(
    (p) => p.name === name && (!marketplace || p.marketplace === marketplace),
  )
  if (!hit) throw new Error(`plugin not installed: ${name}`)
  if (hit.installPath && fs.existsSync(hit.installPath)) {
    fs.rmSync(hit.installPath, { recursive: true, force: true })
  }
  installed.plugins = installed.plugins.filter((p) => p.id !== hit.id)
  writeJson(installedPath(), installed)
  return { ok: true, uninstalled: hit }
}

/**
 * 升级插件：安装市场 catalog 的最新版本。
 * 失败时回滚到已安装版本（installPlugin 半写入场景下恢复 installed.json 快照）。
 */
export async function upgradePlugin(options: InstallOptions): Promise<InstalledPlugin> {
  const { marketplace, name } = options
  if (!name) throw new Error("plugin name required")
  const installed = listInstalledPlugins()
  const prev = (installed.plugins || []).find(
    (p) => p.name === name && (!marketplace || p.marketplace === marketplace),
  )
  try {
    return await installPlugin({ marketplace, name })
  } catch (err) {
    // 回滚点：installPlugin 抛错后，确保 installed.json 仍指向旧版本
    const after = listInstalledPlugins()
    if (prev && !(after.plugins || []).some((p) => p.id === prev.id)) {
      after.plugins = (after.plugins || []).filter((p) => p.id !== prev.id)
      after.plugins.unshift(prev)
      writeJson(installedPath(), after)
    }
    throw err
  }
}

/**
 * 更新市场目录（git pull 或 clone）。
 * 默认更新官方市场 dave-plugins-official。
 */
export async function updateMarketplace(
  marketplaceId = "dave-plugins-official",
): Promise<{ ok: boolean; marketplaceId: string; pluginCount: number }> {
  const dir = path.join(marketplacesRoot(), marketplaceId)
  if (!fs.existsSync(path.join(dir, ".git"))) {
    const known = readJson<KnownMarketplacesFile>(knownPath(), {
      version: 1,
      marketplaces: [],
    }) || { version: 1, marketplaces: [] }
    const mp = (known.marketplaces || []).find((m) => m.id === marketplaceId)
    const repo = mp?.source?.repo
    if (!repo) throw new Error(`no git source for marketplace ${marketplaceId}`)
    fs.mkdirSync(marketplacesRoot(), { recursive: true })
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
    await run(
      "git",
      ["clone", "--depth", "1", `https://github.com/${repo}.git`, dir],
      marketplacesRoot(),
    )
  } else {
    await run("git", ["pull", "--ff-only"], dir)
  }

  const cat =
    readJson<MarketplaceManifest>(path.join(dir, "marketplace.json")) ||
    readJson<MarketplaceManifest>(path.join(dir, ".dave-plugin", "marketplace.json"))
  const known = readJson<KnownMarketplacesFile>(knownPath(), { version: 1, marketplaces: [] }) || {
    version: 1,
    marketplaces: [],
  }
  const rest = (known.marketplaces || []).filter((m) => m.id !== marketplaceId)
  rest.unshift({
    id: marketplaceId,
    source: { source: "github", repo: `dave/${marketplaceId}` },
    name: cat?.name || marketplaceId,
    description: cat?.description || "",
    addedAt: new Date().toISOString(),
    pluginCount: Array.isArray(cat?.plugins) ? cat.plugins.length : 0,
    lastUpdated: new Date().toISOString(),
  })
  known.marketplaces = rest
  writeJson(knownPath(), known)
  return { ok: true, marketplaceId, pluginCount: rest[0].pluginCount }
}

/** 获取插件详情（已安装的返回 manifest，未安装的返回市场元数据） */
export function describePlugin(name: string, marketplace?: string): PluginDescription {
  const installed = listInstalledPlugins().plugins || []
  const hit = installed.find(
    (p) => p.name === name && (!marketplace || p.marketplace === marketplace),
  )
  if (hit) {
    const pj =
      readJson<Record<string, unknown>>(path.join(hit.installPath, "plugin.json")) ||
      readJson<Record<string, unknown>>(path.join(hit.installPath, "package.json")) ||
      readJson<Record<string, unknown>>(path.join(hit.installPath, ".dave-plugin", "plugin.json"))
    return { installed: true, ...hit, manifest: pj || undefined }
  }
  const { catalogs } = listMarketplaces()
  for (const cat of catalogs) {
    if (marketplace && cat.id !== marketplace) continue
    const p = (cat.plugins || []).find((x) => x.name === name)
    if (p) {
      return {
        installed: false,
        marketplace: cat.id,
        name: p.name,
        description: p.description,
        version: p.version,
        source: p.source || undefined,
        category: p.category,
      }
    }
  }
  throw new Error(`plugin not found: ${name}`)
}
