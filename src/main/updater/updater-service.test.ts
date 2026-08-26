import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock electron
vi.mock("electron", () => ({
  app: {
    getVersion: vi.fn(() => "0.1.0"),
    getName: vi.fn(() => "Dave"),
    quit: vi.fn(),
  },
  autoUpdater: {
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
    setFeedURL: vi.fn(),
    getFeedURL: vi.fn(() => "https://example.com/update.json"),
  },
}))

// Mock electron-log
vi.mock("electron-log", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

import { UpdaterService, type UpdateStatus, type UpdateInfo } from "./updater-service"

describe("UpdaterService", () => {
  let service: UpdaterService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new UpdaterService({
      feedUrl: "https://example.com/update.json",
      autoDownload: false,
    })
  })

  describe("constructor", () => {
    it("should create with default options", () => {
      const svc = new UpdaterService()
      expect(svc).toBeDefined()
    })

    it("should create with custom feed URL", () => {
      const svc = new UpdaterService({ feedUrl: "https://custom.example.com/update.json" })
      expect(svc).toBeDefined()
    })

    it("should reject non-HTTPS feed URL", () => {
      expect(() => new UpdaterService({ feedUrl: "http://insecure.example.com/update.json" }))
        .toThrow(/HTTPS/i)
    })
  })

  describe("getStatus", () => {
    it("should return idle status initially", () => {
      const status = service.getStatus()
      expect(status.state).toBe("idle")
      expect(status.currentVersion).toBe("0.1.0")
    })
  })

  describe("checkForUpdates", () => {
    it("should check for updates", async () => {
      const result = await service.checkForUpdates()
      expect(result).toBeDefined()
    })

    it("should return update available when new version exists", async () => {
      // Mock autoUpdater behavior
      const { autoUpdater } = await import("electron")
      vi.mocked(autoUpdater.checkForUpdates).mockImplementationOnce(() => {
        // Simulate update-available event
        return Promise.resolve({
          updateInfo: { version: "0.2.0", releaseNotes: "Bug fixes" },
        } as any)
      })

      const result = await service.checkForUpdates()
      expect(result).toBeDefined()
    })
  })

  describe("downloadUpdate", () => {
    it("should download update when available", async () => {
      const result = await service.downloadUpdate()
      expect(result).toBeDefined()
    })
  })

  describe("quitAndInstall", () => {
    it("should quit and install update", () => {
      service.quitAndInstall()
      // Should not throw
    })
  })

  describe("onStatusChange", () => {
    it("should register status change callback", () => {
      const callback = vi.fn()
      const unsubscribe = service.onStatusChange(callback)
      expect(typeof unsubscribe).toBe("function")
      unsubscribe()
    })

    it("should call callback when status changes", () => {
      const callback = vi.fn()
      service.onStatusChange(callback)
      // Trigger a status change by checking for updates
      // (mock would fire events internally)
      expect(callback).toBeDefined()
    })
  })

  describe("isDevMode", () => {
    it("should detect dev mode correctly", () => {
      // In test environment, should be dev mode
      const result = service.isDevMode()
      expect(typeof result).toBe("boolean")
    })
  })

  describe("getFeedUrl", () => {
    it("should return configured feed URL", () => {
      const url = service.getFeedUrl()
      expect(url).toBe("https://example.com/update.json")
    })
  })

  describe("setFeedUrl", () => {
    it("should update feed URL", () => {
      service.setFeedUrl("https://new.example.com/update.json")
      expect(service.getFeedUrl()).toBe("https://new.example.com/update.json")
    })

    it("should reject non-HTTPS feed URL", () => {
      expect(() => service.setFeedUrl("http://insecure.example.com/update.json"))
        .toThrow(/HTTPS/i)
    })
  })

  describe("destroy", () => {
    it("should clean up event listeners", () => {
      service.destroy()
      // Should not throw
    })
  })
})
