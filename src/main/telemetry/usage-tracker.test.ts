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
}))

import { UsageTracker, type UsageRecord, type DailySummary } from "./usage-tracker"
import * as fs from "node:fs/promises"

describe("UsageTracker", () => {
  let tracker: UsageTracker

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fs.readFile).mockRejectedValue({ code: "ENOENT" } as NodeJS.ErrnoException)
    vi.mocked(fs.mkdir).mockResolvedValue(undefined as any)
    tracker = new UsageTracker({ dataDir: "/tmp/test-usage" })
  })

  describe("constructor", () => {
    it("should create with default data dir", () => {
      const t = new UsageTracker()
      expect(t).toBeDefined()
    })

    it("should create with custom data dir", () => {
      const t = new UsageTracker({ dataDir: "/custom/usage" })
      expect(t).toBeDefined()
    })
  })

  describe("recordModelCall", () => {
    it("should record a model call", () => {
      tracker.recordModelCall({
        provider: "openai",
        model: "gpt-4o",
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cost: 0.003,
        durationMs: 1200,
      })

      const summary = tracker.getTodaysSummary()
      expect(summary.totalCalls).toBe(1)
      expect(summary.totalTokens).toBe(150)
      expect(summary.totalCost).toBeCloseTo(0.003, 5)
    })

    it("should accumulate multiple calls", () => {
      tracker.recordModelCall({
        provider: "openai",
        model: "gpt-4o",
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cost: 0.003,
        durationMs: 1200,
      })
      tracker.recordModelCall({
        provider: "anthropic",
        model: "claude-sonnet",
        promptTokens: 200,
        completionTokens: 100,
        totalTokens: 300,
        cost: 0.009,
        durationMs: 2000,
      })

      const summary = tracker.getTodaysSummary()
      expect(summary.totalCalls).toBe(2)
      expect(summary.totalTokens).toBe(450)
      expect(summary.totalCost).toBeCloseTo(0.012, 5)
    })
  })

  describe("recordToolCall", () => {
    it("should record a tool call", () => {
      tracker.recordToolCall({
        toolName: "bash",
        success: true,
        durationMs: 500,
      })

      const summary = tracker.getTodaysSummary()
      expect(summary.toolCalls["bash"]).toBe(1)
    })

    it("should count multiple calls to same tool", () => {
      tracker.recordToolCall({ toolName: "write_file", success: true })
      tracker.recordToolCall({ toolName: "write_file", success: true })
      tracker.recordToolCall({ toolName: "read_file", success: true })

      const summary = tracker.getTodaysSummary()
      expect(summary.toolCalls["write_file"]).toBe(2)
      expect(summary.toolCalls["read_file"]).toBe(1)
    })

    it("should track failed calls separately", () => {
      tracker.recordToolCall({ toolName: "bash", success: true })
      tracker.recordToolCall({ toolName: "bash", success: false, error: "permission denied" })

      const summary = tracker.getTodaysSummary()
      expect(summary.toolCalls["bash"]).toBe(2)
      expect(summary.failedToolCalls["bash"]).toBe(1)
    })
  })

  describe("recordSession", () => {
    it("should record a session", () => {
      tracker.recordSession({
        sessionId: "sess-1",
        durationMs: 60000,
        messageCount: 10,
      })

      const summary = tracker.getTodaysSummary()
      expect(summary.totalSessions).toBe(1)
      expect(summary.totalMessages).toBe(10)
    })
  })

  describe("getTodaysSummary", () => {
    it("should return zero summary when no records", () => {
      const summary = tracker.getTodaysSummary()
      expect(summary.totalCalls).toBe(0)
      expect(summary.totalTokens).toBe(0)
      expect(summary.totalCost).toBe(0)
      expect(summary.totalSessions).toBe(0)
      expect(summary.toolCalls).toEqual({})
    })

    it("should return correct date", () => {
      const summary = tracker.getTodaysSummary()
      expect(summary.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
  })

  describe("get7DaySummary", () => {
    it("should return array of 7 daily summaries", () => {
      const summaries = tracker.get7DaySummary()
      expect(summaries.length).toBe(7)
      summaries.forEach((s) => {
        expect(s.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      })
    })

    it("should include today's data", () => {
      tracker.recordModelCall({
        provider: "openai",
        model: "gpt-4o",
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cost: 0.003,
        durationMs: 1200,
      })

      const summaries = tracker.get7DaySummary()
      const today = summaries[0]
      expect(today.totalCalls).toBe(1)
    })
  })

  describe("getModelBreakdown", () => {
    it("should return breakdown by model", () => {
      tracker.recordModelCall({
        provider: "openai",
        model: "gpt-4o",
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cost: 0.003,
        durationMs: 1200,
      })
      tracker.recordModelCall({
        provider: "openai",
        model: "gpt-4o-mini",
        promptTokens: 50,
        completionTokens: 25,
        totalTokens: 75,
        cost: 0.00015,
        durationMs: 800,
      })

      const breakdown = tracker.getModelBreakdown()
      expect(breakdown["openai/gpt-4o"].calls).toBe(1)
      expect(breakdown["openai/gpt-4o-mini"].calls).toBe(1)
    })
  })

  describe("exportData", () => {
    it("should export usage data as JSON", () => {
      tracker.recordModelCall({
        provider: "openai",
        model: "gpt-4o",
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cost: 0.003,
        durationMs: 1200,
      })

      const data = tracker.exportData()
      expect(data).toBeDefined()
      const parsed = JSON.parse(data)
      expect(parsed.exportedAt).toBeDefined()
      expect(parsed.dailySummaries).toBeDefined()
    })
  })

  describe("clearData", () => {
    it("should clear all usage data", () => {
      tracker.recordModelCall({
        provider: "openai",
        model: "gpt-4o",
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cost: 0.003,
        durationMs: 1200,
      })

      tracker.clearData()

      const summary = tracker.getTodaysSummary()
      expect(summary.totalCalls).toBe(0)
    })
  })
})
