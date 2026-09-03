import { vi } from "vitest"

// execa v10 requires Node >= 22; mock it for Node 20 test environment
vi.mock("execa", () => ({
  execa: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
  execaCommand: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
  $: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
}))
