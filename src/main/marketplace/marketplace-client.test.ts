import { describe, it, expect, beforeEach } from "vitest"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"

// Set DAVE_HOME to a temp directory
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), "dave-marketplace-test-"))
process.env.DAVE_HOME = testHome

import {
  listMarketplaces,
  listInstalledPlugins,
  installPlugin,
  uninstallPlugin,
  describePlugin,
  upgradePlugin,
} from "./marketplace-client"

function setupMarketplace(
  name: string,
  plugins: Array<{ name: string; description?: string; version?: string }>,
): void {
  const mpDir = path.join(testHome, "cli", "plugins", "marketplaces", name)
  fs.mkdirSync(mpDir, { recursive: true })
  fs.writeFileSync(
    path.join(mpDir, "marketplace.json"),
    JSON.stringify({
      name,
      description: `Test marketplace ${name}`,
      plugins: plugins.map((p) => ({
        name: p.name,
        description: p.description || "",
        version: p.version || "1.0.0",
      })),
    }),
    "utf8",
  )
  // Create plugin source directories
  for (const p of plugins) {
    const pluginDir = path.join(mpDir, "plugins", p.name)
    fs.mkdirSync(pluginDir, { recursive: true })
    fs.writeFileSync(
      path.join(pluginDir, "plugin.json"),
      JSON.stringify({ name: p.name, version: p.version || "1.0.0" }),
      "utf8",
    )
  }
}

describe("MarketplaceClient", () => {
  beforeEach(() => {
    // Clean marketplaces and installed plugins
    const root = path.join(testHome, "cli", "plugins")
    try {
      fs.rmSync(root, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  describe("listMarketplaces", () => {
    it("should return empty when no marketplaces exist", () => {
      const result = listMarketplaces()
      expect(result.catalogs).toEqual([])
      expect(result.known.marketplaces).toEqual([])
    })

    it("should list marketplaces with plugins", () => {
      setupMarketplace("test-mp", [
        { name: "plugin-a", description: "Plugin A" },
        { name: "plugin-b", description: "Plugin B" },
      ])

      const result = listMarketplaces()
      expect(result.catalogs.length).toBe(1)
      expect(result.catalogs[0].id).toBe("test-mp")
      expect(result.catalogs[0].pluginCount).toBe(2)
      expect(result.catalogs[0].plugins.length).toBe(2)
    })
  })

  describe("listInstalledPlugins", () => {
    it("should return empty when no plugins installed", () => {
      const result = listInstalledPlugins()
      expect(result.plugins).toEqual([])
    })
  })

  describe("installPlugin", () => {
    it("should install a plugin from local marketplace source", async () => {
      setupMarketplace("official", [
        { name: "test-plugin", description: "A test plugin", version: "1.0.0" },
      ])

      const installed = await installPlugin({ marketplace: "official", name: "test-plugin" })
      expect(installed.name).toBe("test-plugin")
      expect(installed.marketplace).toBe("official")
      expect(installed.version).toBe("1.0.0")
      expect(fs.existsSync(installed.installPath)).toBe(true)
    })

    it("should list installed plugin after installation", async () => {
      setupMarketplace("official", [{ name: "list-me", version: "2.0.0" }])
      await installPlugin({ marketplace: "official", name: "list-me" })

      const result = listInstalledPlugins()
      expect(result.plugins.length).toBe(1)
      expect(result.plugins[0].name).toBe("list-me")
    })

    it("should install with defaults when plugin not found in catalog", async () => {
      setupMarketplace("official", [{ name: "exists" }])
      const installed = await installPlugin({ marketplace: "official", name: "nonexistent" })
      expect(installed.name).toBe("nonexistent")
      expect(installed.marketplace).toBe("official")
      expect(installed.version).toBe("0.0.0")
    })

    it("should throw when marketplace not found", async () => {
      await expect(installPlugin({ marketplace: "nonexistent", name: "plugin" })).rejects.toThrow(
        /marketplace not found/,
      )
    })
  })

  describe("uninstallPlugin", () => {
    it("should uninstall an installed plugin", async () => {
      setupMarketplace("official", [{ name: "removable", version: "1.0.0" }])
      await installPlugin({ marketplace: "official", name: "removable" })

      const result = uninstallPlugin({ marketplace: "official", name: "removable" })
      expect(result.ok).toBe(true)
      expect(result.uninstalled.name).toBe("removable")

      const after = listInstalledPlugins()
      expect(after.plugins.length).toBe(0)
    })

    it("should throw when plugin not installed", () => {
      expect(() => uninstallPlugin({ name: "never-installed" })).toThrow(/plugin not installed/)
    })
  })

  describe("describePlugin", () => {
    it("should describe an installed plugin", async () => {
      setupMarketplace("official", [{ name: "describe-me", description: "Desc", version: "1.0.0" }])
      await installPlugin({ marketplace: "official", name: "describe-me" })

      const desc = describePlugin("describe-me", "official")
      expect(desc.installed).toBe(true)
      expect(desc.name).toBe("describe-me")
    })

    it("should describe a marketplace plugin (not installed)", () => {
      setupMarketplace("official", [
        { name: "catalog-only", description: "In catalog", version: "3.0.0" },
      ])

      const desc = describePlugin("catalog-only", "official")
      expect(desc.installed).toBe(false)
      expect(desc.name).toBe("catalog-only")
      expect(desc.version).toBe("3.0.0")
    })

    it("should throw when plugin not found anywhere", () => {
      expect(() => describePlugin("ghost-plugin")).toThrow(/plugin not found/)
    })
  })

  describe("upgradePlugin", () => {
    it("should upgrade an installed plugin to the newest catalog version", async () => {
      setupMarketplace("official", [{ name: "upgradable", version: "1.0.0" }])
      const first = await installPlugin({ marketplace: "official", name: "upgradable" })
      expect(first.version).toBe("1.0.0")

      // 市场目录更新到 2.0.0 后执行升级
      setupMarketplace("official", [{ name: "upgradable", version: "2.0.0" }])
      const upgraded = await upgradePlugin({ marketplace: "official", name: "upgradable" })
      expect(upgraded.version).toBe("2.0.0")
      expect(upgraded.id).toBe("upgradable@official")

      const after = listInstalledPlugins().plugins
      expect(after.find((p) => p.name === "upgradable")?.version).toBe("2.0.0")
      expect(fs.existsSync(upgraded.installPath)).toBe(true)
    })

    it("should roll back installed.json snapshot when upgrade fails", async () => {
      setupMarketplace("official", [{ name: "stable", version: "1.0.0" }])
      const first = await installPlugin({ marketplace: "official", name: "stable" })

      // 市场目录被删除 → findCatalogPlugin 抛错 → upgradePlugin 回滚快照
      fs.rmSync(path.join(testHome, "cli", "plugins", "marketplaces", "official"), {
        recursive: true,
        force: true,
      })

      await expect(upgradePlugin({ marketplace: "official", name: "stable" })).rejects.toThrow(
        /marketplace not found/,
      )

      const after = listInstalledPlugins()
      const entry = after.plugins.find((p) => p.name === "stable")
      expect(entry).toBeDefined()
      expect(entry?.version).toBe("1.0.0")
      // 升级前的安装记录及其目录均保留
      expect(fs.existsSync(first.installPath)).toBe(true)
    })

    it("should require plugin name", async () => {
      await expect(upgradePlugin({ marketplace: "official" } as never)).rejects.toThrow(
        /plugin name required/,
      )
    })
  })
})
