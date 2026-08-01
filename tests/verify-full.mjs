// 单次完整验证运行(可复现):unit + integration(smoke) + UAT 编排为单条命令。
// 顺序执行三个验证,任一失败则整体失败(退出码 1);全部通过输出
// "FULL VERIFICATION: ALL PASS (clean exit)" 并退出 0。
// 用法:node tests/verify-full.mjs(前置:已 npm run build,产物为最新代码)
import { execSync } from "node:child_process"
import process from "node:process"

const STEPS = [
  { name: "unit", cmd: "npm test" },
  { name: "integration(smoke)", cmd: "node tests/electron-smoke.mjs" },
  { name: "uat", cmd: "node tests/electron-uat.mjs" },
]

let failed = false
for (const s of STEPS) {
  process.stdout.write(`\n=== ${s.name} ===\n`)
  try {
    execSync(s.cmd, { stdio: "inherit", timeout: 240_000 })
    process.stdout.write(`${s.name}: PASS\n`)
  } catch (err) {
    failed = true
    process.stdout.write(`${s.name}: FAIL (exit ${err.status ?? "unknown"})\n`)
  }
}

process.stdout.write(`\nFULL VERIFICATION: ${failed ? "FAILED" : "ALL PASS (clean exit)"}\n`)
process.exit(failed ? 1 : 0)
