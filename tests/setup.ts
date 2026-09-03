import { vi } from "vitest"

// execa v10 requires Node >= 22; mock it for Node 20 test environment
vi.mock("execa", () => ({
  execa: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
  execaCommand: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
  $: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
}))

// Stub electron-log: unit tests must never write to the production main.log
// (previously validateSender tests leaked real rejections into app logs).
vi.mock("electron-log", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    verbose: vi.fn(),
    debug: vi.fn(),
  },
}))
