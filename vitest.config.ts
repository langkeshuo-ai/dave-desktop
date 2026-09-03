import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    pool: "forks",
    // 负载下真实 spawn(如 mcp client integration)/慢环境可能超过 vitest 默认 5s:
    // 全局放宽到 30s,避免瞬态超时误判失败(validateSender 曾 5356ms 超时)。
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/shared/**/*.ts", "src/main/**/*.ts"],
      exclude: ["src/main/index.ts", "src/main/tray.ts", "src/main/autolaunch.ts"],
      thresholds: {
        statements: 30,
        branches: 40,
        functions: 45,
        lines: 30,
      },
    },
  },
})
