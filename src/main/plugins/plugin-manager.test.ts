import { describe, it, expect, beforeEach } from "vitest"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"

import { PluginManager, type PluginManifest } from "./plugin-manager"

function createPluginDir(base: string, name: string, manifest: Partial<PluginManifest> = {}): void {
  const pluginDir = path.join(base, name)
  fs.mkdirSync(pluginDir, { recursive: true })
  const fullManifest: PluginManifest = {
    name,
    version: "1.0.0",
    description: "",
    main: "index.js",
    permissions: [],
    ...manifest,
  }
  fs.writeFileSync(path.join(pluginDir, "plugin.json"), JSON.stringify(fullManifest), "utf8")
  // Create the main file so loadPlugin doesn't error
  fs.writeFileSync(path.join(pluginDir, "index.js"), "module.exports = {}", "utf8")
}

describe("PluginManager", () => {
  let tempDir: string
  let manager: PluginManager

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dave-plugins-test-"))
    manager = new PluginManager({ pluginDir: tempDir })
  })

  describe("constructor", () => {
    it("should create with default options", () => {
      const mgr = new PluginManager()
      expect(mgr).toBeDefined()
      expect(mgr.getPluginDir()).toContain(".dave")
    })

    it("should create with custom plugin dir", () => {
      const mgr = new PluginManager({ pluginDir: "/custom/plugins" })
      expect(mgr.getPluginDir()).toBe("/custom/plugins")
    })
  })

  describe("discoverPlugins", () => {
    it("should return empty array when plugin dir does not exist", () => {
      const plugins = manager.discoverPlugins()
      expect(plugins).toEqual([])
    })

    it("should discover plugins with valid manifest", () => {
      createPluginDir(tempDir, "plugin-a", {
        description: "Test plugin A",
        permissions: ["network"],
      })
      createPluginDir(tempDir, "plugin-b", { description: "Test plugin B" })

      const plugins = manager.discoverPlugins()
      expect(plugins.length).toBe(2)
      expect(plugins[0].name).toBe("plugin-a")
      expect(plugins[1].name).toBe("plugin-b")
      expect(plugins[0].status).toBe("installed")
    })

    it("should skip directories without manifest", () => {
      fs.mkdirSync(path.join(tempDir, "no-manifest"), { recursive: true })
      createPluginDir(tempDir, "has-manifest")

      const plugins = manager.discoverPlugins()
      expect(plugins.length).toBe(1)
      expect(plugins[0].name).toBe("has-manifest")
    })

    it("should skip hidden directories", () => {
      fs.mkdirSync(path.join(tempDir, ".hidden"), { recursive: true })
      createPluginDir(tempDir, "visible")

      const plugins = manager.discoverPlugins()
      expect(plugins.length).toBe(1)
    })
  })

  describe("listPlugins", () => {
    it("should return empty array initially", () => {
      expect(manager.listPlugins()).toEqual([])
    })

    it("should return discovered plugins", () => {
      createPluginDir(tempDir, "p1")
      createPluginDir(tempDir, "p2")
      manager.discoverPlugins()

      const plugins = manager.listPlugins()
      expect(plugins.length).toBe(2)
    })
  })

  describe("getPlugin", () => {
    it("should return undefined for unknown plugin", () => {
      expect(manager.getPlugin("unknown")).toBeUndefined()
    })

    it("should return plugin info after discovery", () => {
      createPluginDir(tempDir, "find-me", { description: "Findable" })
      manager.discoverPlugins()

      const plugin = manager.getPlugin("find-me")
      expect(plugin).toBeDefined()
      expect(plugin?.name).toBe("find-me")
      expect(plugin?.description).toBe("Findable")
    })
  })

  describe("loadPlugin", () => {
    it("should load a discovered plugin", () => {
      createPluginDir(tempDir, "loadable", { permissions: ["network"] })
      manager.discoverPlugins()

      const result = manager.loadPlugin("loadable")
      expect(result.name).toBe("loadable")
      expect(result.status).toBe("stopped") // loaded but not running
      expect(result.loadedAt).toBeDefined()
    })

    it("should throw when plugin not found", () => {
      expect(() => manager.loadPlugin("nonexistent")).toThrow(/Plugin not found/)
    })

    it("should set error status when main file missing", () => {
      const pluginDir = path.join(tempDir, "no-main")
      fs.mkdirSync(pluginDir, { recursive: true })
      fs.writeFileSync(
        path.join(pluginDir, "plugin.json"),
        JSON.stringify({ name: "no-main", version: "1.0.0", main: "missing.js", permissions: [] }),
        "utf8",
      )
      manager.discoverPlugins()

      const result = manager.loadPlugin("no-main")
      expect(result.status).toBe("error")
      expect(result.error).toContain("Main file not found")
    })
  })

  describe("unloadPlugin", () => {
    it("should return false for unknown plugin", () => {
      expect(manager.unloadPlugin("unknown")).toBe(false)
    })

    it("should unload a loaded plugin", () => {
      createPluginDir(tempDir, "unloadable")
      manager.discoverPlugins()
      manager.loadPlugin("unloadable")

      const result = manager.unloadPlugin("unloadable")
      expect(result).toBe(true)

      const plugin = manager.getPlugin("unloadable")
      expect(plugin?.status).toBe("stopped")
    })
  })

  describe("hasPermission", () => {
    it("should return true when plugin has permission", () => {
      createPluginDir(tempDir, "perm-plugin", { permissions: ["network", "filesystem:read"] })
      manager.discoverPlugins()

      expect(manager.hasPermission("perm-plugin", "network")).toBe(true)
      expect(manager.hasPermission("perm-plugin", "filesystem:read")).toBe(true)
    })

    it("should return false when plugin does not have permission", () => {
      createPluginDir(tempDir, "limited", { permissions: ["network"] })
      manager.discoverPlugins()

      expect(manager.hasPermission("limited", "filesystem:write")).toBe(false)
    })

    it("should return false for unknown plugin", () => {
      expect(manager.hasPermission("unknown", "network")).toBe(false)
    })

    it("should support wildcard permission", () => {
      createPluginDir(tempDir, "wildcard", { permissions: ["*"] })
      manager.discoverPlugins()

      expect(manager.hasPermission("wildcard", "anything")).toBe(true)
      expect(manager.hasPermission("wildcard", "network")).toBe(true)
    })
  })

  describe("canRegisterIpcChannel", () => {
    it("should return true when channel is declared in manifest", () => {
      createPluginDir(tempDir, "ipc-plugin", {
        permissions: [],
        contributes: { ipcChannels: ["my-plugin:action", "my-plugin:event"] },
      })
      manager.discoverPlugins()

      expect(manager.canRegisterIpcChannel("ipc-plugin", "my-plugin:action")).toBe(true)
      expect(manager.canRegisterIpcChannel("ipc-plugin", "my-plugin:event")).toBe(true)
    })

    it("should return false for undeclared channel", () => {
      createPluginDir(tempDir, "strict", {
        permissions: [],
        contributes: { ipcChannels: ["strict:ok"] },
      })
      manager.discoverPlugins()

      expect(manager.canRegisterIpcChannel("strict", "other:channel")).toBe(false)
    })

    it("should support wildcard channel", () => {
      createPluginDir(tempDir, "any-ipc", { permissions: [], contributes: { ipcChannels: ["*"] } })
      manager.discoverPlugins()

      expect(manager.canRegisterIpcChannel("any-ipc", "anything:here")).toBe(true)
    })
  })

  describe("getRunningPlugins", () => {
    it("should return empty array initially", () => {
      expect(manager.getRunningPlugins()).toEqual([])
    })
  })

  describe("getStatus", () => {
    it("should return status object", () => {
      createPluginDir(tempDir, "status-plugin")
      manager.discoverPlugins()

      const status = manager.getStatus()
      expect(status.pluginDir).toBe(tempDir)
      expect(status.totalPlugins).toBe(1)
      expect(status.running).toBe(0)
    })
  })

  describe("failure backoff", () => {
    it("should increment fail count and disable after 3 consecutive failures", () => {
      createPluginDir(tempDir, "tripper")
      manager.discoverPlugins()

      manager.reportFailure("tripper")
      expect(manager.getPlugin("tripper")?.fails).toBe(1)
      expect(manager.getPlugin("tripper")?.disabled).toBeFalsy()

      manager.reportFailure("tripper")
      manager.reportFailure("tripper")
      const plugin = manager.getPlugin("tripper")
      expect(plugin?.fails).toBe(3)
      expect(plugin?.disabled).toBe(true)
      expect(plugin?.status).toBe("error")
      expect(plugin?.error).toContain("disabled")
    })

    it("should reject loadPlugin for a disabled plugin (429 semantics)", () => {
      createPluginDir(tempDir, "blocked")
      manager.discoverPlugins()
      for (let i = 0; i < 3; i++) manager.reportFailure("blocked")

      const result = manager.loadPlugin("blocked")
      expect(result.status).toBe("error")
      expect(result.error).toContain("disabled")
    })

    it("should reset fail count and un-disabled plugin on reportSuccess", () => {
      createPluginDir(tempDir, "recover")
      manager.discoverPlugins()
      for (let i = 0; i < 3; i++) manager.reportFailure("recover")
      expect(manager.getPlugin("recover")?.disabled).toBe(true)

      const result = manager.reportSuccess("recover")
      expect(result?.fails).toBe(0)
      expect(result?.disabled).toBe(false)

      const loaded = manager.loadPlugin("recover")
      expect(loaded.status).toBe("stopped")
    })

    it("should auto-disable a plugin whose main file is missing 3 times", () => {
      const pluginDir = path.join(tempDir, "no-main")
      fs.mkdirSync(pluginDir, { recursive: true })
      fs.writeFileSync(
        path.join(pluginDir, "plugin.json"),
        JSON.stringify({ name: "no-main", version: "1.0.0", main: "missing.js", permissions: [] }),
        "utf8",
      )
      manager.discoverPlugins()

      manager.loadPlugin("no-main")
      manager.loadPlugin("no-main")
      const result = manager.loadPlugin("no-main")
      expect(result.fails).toBe(3)
      expect(result.disabled).toBe(true)
      expect(result.status).toBe("error")
      expect(result.error).toContain("disabled")
    })

    it("should reset backoff count when a plugin loads successfully", () => {
      createPluginDir(tempDir, "flaky")
      manager.discoverPlugins()
      manager.reportFailure("flaky")
      manager.reportFailure("flaky")

      const result = manager.loadPlugin("flaky")
      expect(result.status).toBe("stopped")
      expect(result.fails).toBe(0)
      expect(result.disabled).toBe(false)
    })

    it("should return undefined from reportFailure/reportSuccess for unknown plugin", () => {
      expect(manager.reportFailure("ghost")).toBeUndefined()
      expect(manager.reportSuccess("ghost")).toBeUndefined()
    })

    it("should emit plugin:disabled when threshold is crossed", () => {
      createPluginDir(tempDir, "emit-me")
      manager.discoverPlugins()
      let disabledName: string | undefined
      manager.on("plugin:disabled", (p: { name: string }) => {
        disabledName = p.name
      })

      for (let i = 0; i < 3; i++) manager.reportFailure("emit-me")
      expect(disabledName).toBe("emit-me")
    })
  })
})
