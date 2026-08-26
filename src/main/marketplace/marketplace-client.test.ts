import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock electron
vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/test-user-data"),
    getName: vi.fn(() => "Dave"),
  },
}))

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  readdir: vi.fn(),
  mkdir: vi.fn(),
  rm: vi.fn(),
  stat: vi.fn(),
  access: vi.fn(),
  copyFile: vi.fn(),
}))

// Mock child_process
vi.mock("node:child_process", () => ({
  exec: vi.fn((_cmd, _opts, cb) => cb(null, { stdout: "", stderr: "" })),
}))

import { MarketplaceClient, type MarketplacePlugin, type InstallResult } from "./marketplace-client"
import * as fs from "node:fs/promises"

describe("MarketplaceClient", () => {
  let client: MarketplaceClient

  beforeEach(() => {
    vi.clearAllMocks()
    client = new MarketplaceClient({
      registryUrl: "https://marketplace.example.com",
      pluginsDir: "/tmp/test-plugins",
    })
  })

  describe("constructor", () => {
    it("should create with default options", () => {
      const c = new MarketplaceClient()
      expect(c).toBeDefined()
    })

    it("should create with custom registry URL", () => {
      const c = new MarketplaceClient({ registryUrl: "https://custom.marketplace.com" })
      expect(c).toBeDefined()
    })
  })

  describe("searchPlugins", () => {
    it("should return search results", async () => {
      // Mock fetch
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          plugins: [
            { id: "plugin-1", name: "Plugin 1", version: "1.0.0", description: "Test" },
            { id: "plugin-2", name: "Plugin 2", version: "2.0.0", description: "Test" },
          ],
          total: 2,
        }),
      })
      vi.stubGlobal("fetch", mockFetch)

      const results = await client.searchPlugins("test")
      expect(results.plugins.length).toBe(2)
      expect(results.total).toBe(2)
    })

    it("should handle empty search results", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ plugins: [], total: 0 }),
      })
      vi.stubGlobal("fetch", mockFetch)

      const results = await client.searchPlugins("nonexistent")
      expect(results.plugins).toEqual([])
      expect(results.total).toBe(0)
    })

    it("should handle network errors gracefully", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"))
      vi.stubGlobal("fetch", mockFetch)

      await expect(client.searchPlugins("test")).rejects.toThrow("Network error")
    })
  })

  describe("getPluginDetails", () => {
    it("should return plugin details", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: "plugin-1",
          name: "Plugin 1",
          version: "1.0.0",
          description: "A test plugin",
          author: "test-author",
          downloads: 1000,
          rating: 4.5,
        }),
      })
      vi.stubGlobal("fetch", mockFetch)

      const details = await client.getPluginDetails("plugin-1")
      expect(details.id).toBe("plugin-1")
      expect(details.name).toBe("Plugin 1")
    })

    it("should throw when plugin not found", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      })
      vi.stubGlobal("fetch", mockFetch)

      await expect(client.getPluginDetails("nonexistent")).rejects.toThrow()
    })
  })

  describe("installPlugin", () => {
    it("should install plugin from git URL", async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined as any)
      vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => false } as any)

      const result: InstallResult = await client.installPlugin({
        id: "test-plugin",
        name: "Test Plugin",
        version: "1.0.0",
        source: { type: "git", url: "https://github.com/test/plugin.git" },
      })

      expect(result.success).toBe(true)
      expect(result.pluginId).toBe("test-plugin")
    })

    it("should install plugin from local path", async () => {
      vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any)
      vi.mocked(fs.cp as any).mockResolvedValue(undefined as any)

      const result: InstallResult = await client.installPlugin({
        id: "local-plugin",
        name: "Local Plugin",
        version: "1.0.0",
        source: { type: "local", path: "/local/plugin" },
      })

      expect(result.success).toBe(true)
    })
  })

  describe("uninstallPlugin", () => {
    it("should uninstall an installed plugin", async () => {
      vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any)
      vi.mocked(fs.rm).mockResolvedValue(undefined as any)

      const result = await client.uninstallPlugin("test-plugin")
      expect(result.success).toBe(true)
    })

    it("should return false when plugin not installed", async () => {
      vi.mocked(fs.stat).mockRejectedValue({ code: "ENOENT" } as NodeJS.ErrnoException)

      const result = await client.uninstallPlugin("nonexistent")
      expect(result.success).toBe(false)
    })
  })

  describe("listInstalledPlugins", () => {
    it("should return empty array when no plugins installed", async () => {
      vi.mocked(fs.readdir).mockRejectedValue({ code: "ENOENT" } as NodeJS.ErrnoException)

      const plugins = await client.listInstalledPlugins()
      expect(plugins).toEqual([])
    })

    it("should list installed plugins", async () => {
      vi.mocked(fs.readdir).mockResolvedValue(["plugin-a", "plugin-b"] as any)
      vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any)
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({
        name: "plugin-a",
        version: "1.0.0",
        description: "Test",
        main: "index.js",
      }))

      const plugins = await client.listInstalledPlugins()
      expect(plugins.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe("checkForUpdates", () => {
    it("should check for plugin updates", async () => {
      vi.mocked(fs.readdir).mockRejectedValue({ code: "ENOENT" } as NodeJS.ErrnoException)

      const updates = await client.checkForUpdates()
      expect(updates).toEqual([])
    })
  })

  describe("getRegistryUrl", () => {
    it("should return configured registry URL", () => {
      expect(client.getRegistryUrl()).toBe("https://marketplace.example.com")
    })
  })

  describe("setRegistryUrl", () => {
    it("should update registry URL", () => {
      client.setRegistryUrl("https://new.marketplace.com")
      expect(client.getRegistryUrl()).toBe("https://new.marketplace.com")
    })
  })
})
