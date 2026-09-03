/**
 * IPC sender 校验覆盖静态审计（门禁）
 *
 * 断言 src/main/ipc.ts 中每个 `ipcMain.handle("chan", handler)` 块都直接包含
 * sender 校验（validateSender / security 包装），杜绝未来新增 handler 漏校验。
 *
 * 与 scan-ipc-consistency.mjs（preload↔main 双向通道一致性）并列：
 * 前者查"通道缺不缺"，本脚本查"handler 有没有 sender 守卫"。
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const file = resolve("src/main/ipc.ts")
const src = readFileSync(file, "utf8")

// 解析 ipcMain.handle("chan", handler) 块（读到第一个结构闭合 `})`）
const re = /ipcMain\.handle\(\s*"([^"]+)"\s*,\s*[\s\S]*?\n\s*\}\)/g
let m
let total = 0
const missing = []
while ((m = re.exec(src))) {
  const chan = m[1]
  const block = m[0]
  total++
  if (
    !block.includes("validateSender") &&
    !block.includes("security.handle") &&
    !block.includes("safeHandle")
  ) {
    missing.push(chan)
  }
}

if (missing.length > 0) {
  console.error(`sender-coverage: ${missing.length} handler(s) MISSING sender validation: ${missing.join(", ")}`)
  process.exit(1)
}
console.log(`sender-coverage: OK (${total} ipcMain.handle, all with sender guard)`)