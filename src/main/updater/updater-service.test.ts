import { describe, it, expect, beforeEach, vi } from "vitest"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"

// Set DAVE_HOME to temp directory
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), "dave-updater-test-"))
process.env.DAVE_HOME = testHome

// Mock electron — app.getVersion and isPackaged
vi.mock("electron", () => ({
  app: {
    getVersion: vi.fn(() => "0.1.0"),
    isPackaged: false,
  },
}))

// Mock node:module createRequire to intercept CommonJS require("electron")
vi.mock("node:module", async () => {
  const actual = await vi.importActual<typeof import("node:module")>("node:module")
  return {
    ...actual,
    createRequire: () => (id: string) => {
      if (id === "electron") return { app: { getVersion: () => "0.1.0", isPackaged: false } }
      return actual.createRequire(import.meta.url)(id)
    },
  }
})

import {
  getUpdateStatus,
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
  setUpdateConfig,
  wireAutoUpdater,
} from "./updater-service"

describe("UpdaterService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clean state file
    const stateFile = path.join(testHome, "client", "update-state.json")
    try {
      fs.rmSync(stateFile, { force: true })
    } catch {
      // ignore
    }
  })

  describe("getUpdateStatus", () => {
    it("should return status with current version", async () => {
      const status = await getUpdateStatus()
      expect(status.currentVersion).toBe("0.1.0")
      expect(status.isPackaged).toBe(false)
      expect(status.channel).toBe("stable")
      expect(status.autoDownload).toBe(true)
    })
  })

  describe("setUpdateConfig", () => {
    it("should update channel", () => {
      const state = setUpdateConfig({ channel: "beta" })
      expect(state.channel).toBe("beta")
    })

    it("should update autoDownload", () => {
      const state = setUpdateConfig({ autoDownload: false })
      expect(state.autoDownload).toBe(false)
    })

    it("should validate HTTPS feed URL", () => {
      expect(() => setUpdateConfig({ feedUrl: "http://insecure.example.com/" })).toThrow(/HTTPS/)
    })

    it("should accept HTTPS feed URL", () => {
      const state = setUpdateConfig({ feedUrl: "https://updates.example.com/" })
      expect(state.feedUrl).toContain("updates.example.com")
    })
  })

  describe("checkForUpdates", () => {
    it("should return dev-mode status when not packaged", async () => {
      // Mock fetch to return a feed
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: "0.2.0" }),
      })
      vi.stubGlobal("fetch", mockFetch)

      const result = await checkForUpdates({ feedUrl: "https://updates.example.com/" })
      expect(result.status).toBe("dev-mode")
      expect(result.currentVersion).toBe("0.1.0")
      expect(result.feedMeta).toBeDefined()
    })

    it("should detect update available when versions differ", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: "9.9.9" }),
      })
      vi.stubGlobal("fetch", mockFetch)

      const result = await checkForUpdates({ feedUrl: "https://updates.example.com/" })
      expect(result.updateAvailable).toBe(true)
    })

    it("should detect no update when versions match", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: "0.1.0" }),
      })
      vi.stubGlobal("fetch", mockFetch)

      const result = await checkForUpdates({ feedUrl: "https://updates.example.com/" })
      expect(result.updateAvailable).toBe(false)
    })

    it("should handle fetch errors gracefully", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"))
      vi.stubGlobal("fetch", mockFetch)

      const result = await checkForUpdates({ feedUrl: "https://updates.example.com/" })
      expect(result.feedMeta?.error).toBeDefined()
      expect(result.updateAvailable).toBe(false)
    })
  })

  describe("downloadUpdate", () => {
    it("should return not-available in dev mode", async () => {
      const result = await downloadUpdate()
      expect(result.ok).toBe(false)
      expect(result.message).toContain("packaged")
    })
  })

  describe("quitAndInstall", () => {
    it("should return not-available in dev mode", async () => {
      const result = await quitAndInstall()
      expect(result.ok).toBe(false)
      expect(result.message).toContain("packaged")
    })
  })

  describe("wireAutoUpdater", () => {
    it("should return not-wired in dev mode", async () => {
      const result = await wireAutoUpdater()
      expect(result.wired).toBe(false)
    })
  })
})
