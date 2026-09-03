// 单次完整验证运行(可复现):build + unit + integration(chat:e2e 真实会话) + UAT 编排为单条命令。
// 脚本内已含 build 步骤(产物始终为最新源码),顺序执行四个步骤,任一失败则整体
// 失败(退出码 1);全部通过输出 "FULL VERIFICATION: ALL PASS (clean exit)" 并退出 0。
// 用法:node tests/verify-full.mjs(无需手动 build)
import { execSync } from "node:child_process"
import process from "node:process"

const STEPS = [
  // IPC 契约一致性门禁（preload↔main 双向，静态快检，放最前快速失败）
  { name: "ipc-consistency", cmd: "node scripts/scan-ipc-consistency.mjs", timeout: 60_000 },
  // IPC sender 校验覆盖门禁（每个 ipcMain.handle 必须含 sender 守卫）
  { name: "sender-coverage", cmd: "node scripts/audit-sender-coverage.mjs", timeout: 60_000 },
  // 必须先 build:E2E 启动 electron 加载 out/ 产物,不 rebuild 会验证旧代码(假绿)
  { name: "build", cmd: "npm run build", timeout: 300_000 },
  { name: "unit", cmd: "npm test", timeout: 240_000 },
  // 真实会话门禁(取代面向旧 renderer UI 的 electron-smoke.mjs,v0.4 已删除)
  { name: "integration(chat:e2e)", cmd: "node tests/chat-stream.e2e.mjs", timeout: 240_000 },
  { name: "e2e(preview)", cmd: "node tests/frontend-preview.e2e.mjs", timeout: 120_000 },
  // 新链 UAT(设置面板交互验收,v0.4 重写,面向新 renderer)
  { name: "uat", cmd: "node tests/electron-uat.mjs", timeout: 240_000 },
]

let failed = false
for (const s of STEPS) {
  process.stdout.write(`\n=== ${s.name} ===\n`)
  try {
    execSync(s.cmd, { stdio: "inherit", timeout: s.timeout ?? 240_000 })
    process.stdout.write(`${s.name}: PASS\n`)
  } catch (err) {
    failed = true
    const signal = err.signal ? ` signal=${err.signal}` : ""
    const timedOut = err.killed ? " (timed out)" : ""
    process.stdout.write(`${s.name}: FAIL (exit ${err.status ?? "unknown"}${timedOut}${signal})\n`)
    // build 失败后停止管线:后续步骤针对旧/部分 out/ 产物会给出误导性 PASS
    if (s.name === "build") break
  }
}

process.stdout.write(`\nFULL VERIFICATION: ${failed ? "FAILED" : "ALL PASS (clean exit)"}\n`)
process.exit(failed ? 1 : 0)
