/**
 * Browser Policy Tests — 浏览器安全策略测试
 *
 * 覆盖 src/main/security/browser-policy.ts 的核心功能。
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("electron", () => ({
  app: { isPackaged: false },
}))

import { BrowserPolicy } from "../security/browser-policy"

describe("BrowserPolicy", () => {
  describe("checkExternalUrl", () => {
    it("allows HTTPS URLs", () => {
      const policy = new BrowserPolicy({ isDev: false })
      const result = policy.checkExternalUrl("https://example.com")
      expect(result.allowed).toBe(true)
      expect(result.protocol).toBe("https:")
    })

    it("allows HTTPS with path and query", () => {
      const policy = new BrowserPolicy({ isDev: false })
      const result = policy.checkExternalUrl("https://example.com/path?query=value#hash")
      expect(result.allowed).toBe(true)
      expect(result.hostname).toBe("example.com")
    })

    it("blocks HTTP in production mode", () => {
      const policy = new BrowserPolicy({ isDev: false })
      const result = policy.checkExternalUrl("http://example.com")
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("not in allowlist")
    })

    it("allows HTTP localhost in dev mode", () => {
      const policy = new BrowserPolicy({ isDev: true, devPorts: [5173] })
      const result = policy.checkExternalUrl("http://localhost:5173")
      expect(result.allowed).toBe(true)
      expect(result.hostname).toBe("localhost")
    })

    it("allows HTTP 127.0.0.1 in dev mode", () => {
      const policy = new BrowserPolicy({ isDev: true, devPorts: [3000] })
      const result = policy.checkExternalUrl("http://127.0.0.1:3000")
      expect(result.allowed).toBe(true)
    })

    it("blocks HTTP non-localhost in dev mode", () => {
      const policy = new BrowserPolicy({ isDev: true })
      const result = policy.checkExternalUrl("http://external.com")
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("HTTP only allowed for localhost")
    })

    it("blocks HTTP localhost with non-allowed port in dev mode", () => {
      const policy = new BrowserPolicy({ isDev: true, devPorts: [5173] })
      const result = policy.checkExternalUrl("http://localhost:9999")
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("not in dev allowlist")
    })

    it("blocks javascript: protocol", () => {
      const policy = new BrowserPolicy({ isDev: false })
      const result = policy.checkExternalUrl("javascript:alert(1)")
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("blocked")
    })

    it("blocks data: protocol", () => {
      const policy = new BrowserPolicy({ isDev: false })
      const result = policy.checkExternalUrl("data:text/html,<script>alert(1)</script>")
      expect(result.allowed).toBe(false)
    })

    it("blocks file: protocol", () => {
      const policy = new BrowserPolicy({ isDev: false })
      const result = policy.checkExternalUrl("file:///etc/passwd")
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("blocked")
    })

    it("blocks vbscript: protocol", () => {
      const policy = new BrowserPolicy({ isDev: false })
      const result = policy.checkExternalUrl("vbscript:msgbox(1)")
      expect(result.allowed).toBe(false)
    })

    it("rejects invalid URLs", () => {
      const policy = new BrowserPolicy({ isDev: false })
      const result = policy.checkExternalUrl("not a url")
      expect(result.allowed).toBe(false)
      expect(result.reason).toBe("Invalid URL")
    })

    it("rejects empty string", () => {
      const policy = new BrowserPolicy({ isDev: false })
      const result = policy.checkExternalUrl("")
      expect(result.allowed).toBe(false)
    })
  })

  describe("checkLocalPath", () => {
    it("allows paths within home directory", () => {
      const policy = new BrowserPolicy()
      const home = process.env.HOME || process.env.USERPROFILE || "/home/user"
      const result = policy.checkLocalPath(`${home}/documents/file.txt`)
      expect(result.allowed).toBe(true)
    })

    it("rejects relative paths", () => {
      const policy = new BrowserPolicy()
      const result = policy.checkLocalPath("relative/path.txt")
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("must be absolute")
    })

    it("rejects paths with null bytes", () => {
      const policy = new BrowserPolicy()
      const result = policy.checkLocalPath("/etc/passwd\0.txt")
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("null byte")
    })

    it("rejects empty path", () => {
      const policy = new BrowserPolicy()
      const result = policy.checkLocalPath("")
      expect(result.allowed).toBe(false)
    })

    it("rejects paths outside trusted roots", () => {
      const policy = new BrowserPolicy({ trustedRoots: ["/allowed"] })
      const result = policy.checkLocalPath("/etc/passwd")
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("outside trusted roots")
    })

    it("allows paths within custom trusted root", () => {
      const policy = new BrowserPolicy({ trustedRoots: ["/tmp"] })
      const result = policy.checkLocalPath("/tmp/some/file.txt")
      expect(result.allowed).toBe(true)
    })
  })

  describe("checkNavigation", () => {
    it("allows navigation to allowed hosts", () => {
      const policy = new BrowserPolicy({ isDev: false })
      const result = policy.checkNavigation("https://app.example.com/page", ["example.com"])
      expect(result.allowed).toBe(true)
    })

    it("allows subdomains of allowed hosts", () => {
      const policy = new BrowserPolicy({ isDev: false })
      const result = policy.checkNavigation("https://sub.domain.example.com", ["example.com"])
      expect(result.allowed).toBe(true)
    })

    it("blocks navigation to non-allowed hosts", () => {
      const policy = new BrowserPolicy({ isDev: false })
      const result = policy.checkNavigation("https://evil.com", ["example.com"])
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("not in navigation allowlist")
    })

    it("blocks insecure protocols even with host allowlist", () => {
      const policy = new BrowserPolicy({ isDev: false })
      const result = policy.checkNavigation("http://example.com", ["example.com"])
      expect(result.allowed).toBe(false)
    })

    it("allows all hosts when allowlist is empty", () => {
      const policy = new BrowserPolicy({ isDev: false })
      const result = policy.checkNavigation("https://any-site.com", [])
      expect(result.allowed).toBe(true)
    })
  })

  describe("checkPopup", () => {
    it("allows HTTPS popups", () => {
      const policy = new BrowserPolicy({ isDev: false })
      const result = policy.checkPopup("https://example.com")
      expect(result.allowed).toBe(true)
    })

    it("blocks file: popups", () => {
      const policy = new BrowserPolicy({ isDev: false })
      const result = policy.checkPopup("file:///local/file.html")
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("blocked")
    })

    it("blocks javascript: popups", () => {
      const policy = new BrowserPolicy({ isDev: false })
      const result = policy.checkPopup("javascript:alert(1)")
      expect(result.allowed).toBe(false)
    })
  })

  describe("getStatus", () => {
    it("returns policy status for diagnostics", () => {
      const policy = new BrowserPolicy({ isDev: false })
      const status = policy.getStatus()
      expect(status.isDev).toBe(false)
      expect(Array.isArray(status.allowedProtocols)).toBe(true)
      expect(status.allowedProtocols).toContain("https:")
      expect(typeof status.trustedRootsCount).toBe("number")
    })

    it("includes dev protocols when in dev mode", () => {
      const policy = new BrowserPolicy({ isDev: true })
      const status = policy.getStatus()
      expect(status.allowedProtocols).toContain("http:")
    })
  })
})
