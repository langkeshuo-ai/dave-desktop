import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"

// Set DAVE_HOME to a temp directory before importing the module
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), "dave-usage-test-"))
process.env.DAVE_HOME = testHome

import {
  trackModelCall,
  trackToolUse,
  trackSessionCreated,
  trackMessage,
  getTodayUsage,
  getUsageSummary,
  getDailyUsage,
  exportUsage,
  purgeUsageBefore,
} from "./usage-tracker"

function cleanupDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

describe("UsageTracker", () => {
  beforeEach(() => {
    // Clear the usage directory before each test
    const usageDir = path.join(testHome, "client", "usage")
    cleanupDir(usageDir)
  })

  afterEach(() => {
    // noop
  })

  describe("trackModelCall", () => {
    it("should record a model call", () => {
      trackModelCall({
        model: "gpt-4o",
        provider: "openai",
        promptTokens: 100,
        completionTokens: 50,
        costUsd: 0.003,
      })

      const today = getTodayUsage()
      expect(today.models["gpt-4o"]).toBeDefined()
      expect(today.models["gpt-4o"].calls).toBe(1)
      expect(today.models["gpt-4o"].promptTokens).toBe(100)
      expect(today.models["gpt-4o"].completionTokens).toBe(50)
      expect(today.models["gpt-4o"].totalTokens).toBe(150)
      expect(today.models["gpt-4o"].costUsd).toBeCloseTo(0.003, 5)
    })

    it("should accumulate multiple calls", () => {
      trackModelCall({ model: "gpt-4o", promptTokens: 100, completionTokens: 50, costUsd: 0.003 })
      trackModelCall({
        model: "claude-sonnet",
        provider: "anthropic",
        promptTokens: 200,
        completionTokens: 100,
        costUsd: 0.009,
      })

      const today = getTodayUsage()
      expect(Object.keys(today.models).length).toBe(2)
    })

    it("should track provider distribution", () => {
      trackModelCall({ model: "gpt-4o", provider: "openai" })
      trackModelCall({ model: "gpt-4o-mini", provider: "openai" })

      const today = getTodayUsage()
      expect(today.providers["openai"]).toBe(2)
    })
  })

  describe("trackToolUse", () => {
    it("should record a tool use", () => {
      trackToolUse({ tool: "bash" })

      const today = getTodayUsage()
      expect(today.tools["bash"]).toBeDefined()
      expect(today.tools["bash"].count).toBe(1)
    })

    it("should count multiple uses of same tool", () => {
      trackToolUse({ tool: "write_file" })
      trackToolUse({ tool: "write_file" })
      trackToolUse({ tool: "read_file" })

      const today = getTodayUsage()
      expect(today.tools["write_file"].count).toBe(2)
      expect(today.tools["read_file"].count).toBe(1)
    })
  })

  describe("trackSessionCreated", () => {
    it("should increment session count", () => {
      trackSessionCreated()
      trackSessionCreated()

      const today = getTodayUsage()
      expect(today.sessions.created).toBe(2)
    })
  })

  describe("trackMessage", () => {
    it("should track message count and average length", () => {
      trackMessage(100)
      trackMessage(200)

      const today = getTodayUsage()
      expect(today.sessions.messages).toBe(2)
      expect(today.sessions.avgMessageLength).toBe(150)
    })
  })

  describe("getDailyUsage", () => {
    it("should return empty daily usage for date with no data", () => {
      const usage = getDailyUsage("2020-01-01")
      expect(usage.models).toEqual({})
      expect(usage.tools).toEqual({})
      expect(usage.sessions.created).toBe(0)
    })
  })

  describe("getUsageSummary", () => {
    it("should return zero summary when no records", () => {
      const summary = getUsageSummary()
      expect(summary.totalCalls).toBe(0)
      expect(summary.totalTokens).toBe(0)
      expect(summary.totalSessions).toBe(0)
    })

    it("should aggregate data from today", () => {
      trackModelCall({ model: "gpt-4o", promptTokens: 100, completionTokens: 50, costUsd: 0.003 })
      trackToolUse({ tool: "bash" })

      const summary = getUsageSummary()
      expect(summary.totalCalls).toBe(1)
      expect(summary.totalTokens).toBe(150)
      expect(summary.topModels.length).toBeGreaterThanOrEqual(1)
      expect(summary.topTools.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe("exportUsage", () => {
    it("should export usage data as JSON string", () => {
      trackModelCall({ model: "gpt-4o", promptTokens: 100, completionTokens: 50 })

      const data = exportUsage()
      expect(typeof data).toBe("string")
      const parsed = JSON.parse(data)
      expect(parsed.totalCalls).toBe(1)
    })
  })

  describe("purgeUsageBefore", () => {
    it("should return 0 when no files to purge", () => {
      const count = purgeUsageBefore("2020-01-01")
      expect(count).toBe(0)
    })
  })
})
