import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock electron
vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/test-user-data"),
    getName: vi.fn(() => "Dave"),
    getVersion: vi.fn(() => "0.1.0"),
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
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
}))

// Mock child_process
vi.mock("node:child_process", () => ({
  exec: vi.fn((_cmd, _opts, cb) => cb(null, { stdout: "", stderr: "" })),
}))

import { PluginManager, type PluginManifest, type PluginPermission } from "./plugin-manager"
import * as fs from "node:fs/promises"

describe("PluginManager", () => {
  let manager: PluginManager

  beforeEach(() => {
    vi.clearAllMocks()
    manager = new PluginManager({ pluginsDir: "/tmp/test-plugins" })
  })

  describe("constructor", () => {
    it("should create with default plugins dir", () => {
      const mgr = new PluginManager()
      expect(mgr).toBeDefined()
    })

    it("should create with custom plugins dir", () => {
      const mgr = new PluginManager({ pluginsDir: "/custom/plugins" })
      expect(mgr).toBeDefined()
    })
  })

  describe("discoverPlugins", () => {
    it("should return empty array when plugins dir does not exist", async () => {
      vi.mocked(fs.readdir).mockRejectedValueOnce({ code: "ENOENT" } as NodeJS.ErrnoException)
      const plugins = await manager.discoverPlugins()
      expect(plugins).toEqual([])
    })

    it("should discover plugins with valid manifest", async () => {
      vi.mocked(fs.readdir).mockResolvedValueOnce(["plugin-a", "plugin-b"] as any)
      vi.mocked(fs.stat).mockResolvedValueOnce({ isDirectory: () => true } as any)
      vi.mocked(fs.stat).mockResolvedValueOnce({ isDirectory: () => true } as any)
      vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify({
        name: "plugin-a",
        version: "1.0.0",
        description: "Test plugin A",
        main: "index.js",
        permissions: [],
      }))
      vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify({
        name: "plugin-b",
        version: "2.0.0",
        description: "Test plugin B",
        main: "index.js",
        permissions: ["network"],
      }))

      const plugins = await manager.discoverPlugins()
      expect(plugins.length).toBe(2)
      expect(plugins[0].name).toBe("plugin-a")
      expect(plugins[1].name).toBe("plugin-b")
    })

    it("should skip plugins without manifest", async () => {
      vi.mocked(fs.readdir).mockResolvedValueOnce(["no-manifest"] as any)
      vi.mocked(fs.stat).mockResolvedValueOnce({ isDirectory: () => true } as any)
      vi.mocked(fs.readFile).mockRejectedValueOnce({ code: "ENOENT" } as NodeJS.ErrnoException)

      const plugins = await manager.discoverPlugins()
      expect(plugins).toEqual([])
    })
  })

  describe("validateManifest", () => {
    it("should accept valid manifest", () => {
      const manifest: PluginManifest = {
        name: "test-plugin",
        version: "1.0.0",
        description: "A test plugin",
        main: "index.js",
        permissions: [],
      }
      const result = manager.validateManifest(manifest)
      expect(result.valid).toBe(true)
    })

    it("should reject manifest without name", () => {
      const manifest = { version: "1.0.0", main: "index.js" } as any
      const result = manager.validateManifest(manifest)
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it("should reject manifest without main", () => {
      const manifest = { name: "test", version: "1.0.0" } as any
      const result = manager.validateManifest(manifest)
      expect(result.valid).toBe(false)
    })

    it("should reject invalid semver version", () => {
      const manifest = { name: "test", version: "not-a-version", main: "index.js" } as any
      const result = manager.validateManifest(manifest)
      expect(result.valid).toBe(false)
    })

    it("should accept manifest with permissions", () => {
      const manifest: PluginManifest = {
        name: "test-plugin",
        version: "1.0.0",
        description: "A test plugin",
        main: "index.js",
        permissions: ["network", "filesystem:read"],
      }
      const result = manager.validateManifest(manifest)
      expect(result.valid).toBe(true)
    })
  })

  describe("checkPermission", () => {
    it("should allow when plugin has permission", () => {
      const permissions: PluginPermission[] = ["network", "filesystem:read"]
      expect(manager.checkPermission(permissions, "network")).toBe(true)
      expect(manager.checkPermission(permissions, "filesystem:read")).toBe(true)
    })

    it("should deny when plugin does not have permission", () => {
      const permissions: PluginPermission[] = ["network"]
      expect(manager.checkPermission(permissions, "filesystem:write")).toBe(false)
    })

    it("should deny when permissions list is empty", () => {
      expect(manager.checkPermission([], "network")).toBe(false)
    })

    it("should support wildcard permission", () => {
      const permissions: PluginPermission[] = ["*"]
      expect(manager.checkPermission(permissions, "network")).toBe(true)
      expect(manager.checkPermission(permissions, "filesystem:write")).toBe(true)
    })
  })

  describe("loadPlugin", () => {
    it("should load a plugin and register IPC channels", async () => {
      const manifest: PluginManifest = {
        name: "test-plugin",
        version: "1.0.0",
        description: "Test",
        main: "index.js",
        permissions: [],
        ipcChannels: ["test-plugin:action"],
      }

      const result = await manager.loadPlugin(manifest)
      expect(result.loaded).toBe(true)
      expect(result.name).toBe("test-plugin")
    })
  })

  describe("unloadPlugin", () => {
    it("should unload a loaded plugin", async () => {
      const manifest: PluginManifest = {
        name: "test-plugin",
        version: "1.0.0",
        description: "Test",
        main: "index.js",
        permissions: [],
      }
      await manager.loadPlugin(manifest)

      const result = await manager.unloadPlugin("test-plugin")
      expect(result.unloaded).toBe(true)
    })

    it("should return false when plugin not found", async () => {
      const result = await manager.unloadPlugin("nonexistent")
      expect(result.unloaded).toBe(false)
    })
  })

  describe("getLoadedPlugins", () => {
    it("should return empty array initially", () => {
      expect(manager.getLoadedPlugins()).toEqual([])
    })

    it("should return loaded plugins", async () => {
      const manifest: PluginManifest = {
        name: "test-plugin",
        version: "1.0.0",
        description: "Test",
        main: "index.js",
        permissions: [],
      }
      await manager.loadPlugin(manifest)

      const plugins = manager.getLoadedPlugins()
      expect(plugins.length).toBe(1)
      expect(plugins[0].name).toBe("test-plugin")
    })
  })
})
