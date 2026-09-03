/**
 * IPC 契约一致性门禁（archcore：契约注册库单一真相源）
 *
 * 核查 renderer(preload) 暴露的通道与 main 注册的 handler 双向一致：
 *  1. preload invoke 的通道必须在 main 有对应 handler（security.handle / ipcMain.handle / ipcMain.on）
 *  2. main 注册的非推送通道应被 preload 消费（discover 死通道，仅报告不失败）
 *  3. 主→渲染推送通道（pushWithGuard 注册 + webContents.send 发射）与 menu-action 动作 payload 视为豁免
 *
 * 用法：node scripts/scan-ipc-consistency.mjs
 * 失败即退出码 1（真缺口）。
 */
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const preload = fs.readFileSync(path.join(root, "src", "preload", "index.ts"), "utf8")
const main = fs.readFileSync(path.join(root, "src", "main", "ipc.ts"), "utf8")
const pushSrc = fs.readFileSync(path.join(root, "src", "main", "security", "push-channels.ts"), "utf8")

// 宽松匹配：允许 handle(" 与 handle(\n  " 换行形式
function collect(src, re) {
  const out = new Set()
  for (const m of src.matchAll(re)) out.add(m[1])
  return out
}
const invokeRe = /ipcRenderer\.invoke\([\r\n\s]*"([a-z:.-]+)"/g
const listenRe = /ipcRenderer\.on\([\r\n\s]*"([a-z:.-]+)"/g
const handleRe = /(?:security\.handle|ipcMain\.handle)\([\r\n\s]*"([a-z:.-]+)"/g
const ipcOnRe = /ipcMain\.on\([\r\n\s]*"([a-z:.-]+)"/g
const pushRe = /registerPushChannel\([\r\n\s]*"([a-z:.-]+)"/g

const preloadInvoke = collect(preload, invokeRe)
const preloadListen = collect(preload, listenRe)
const mainHandlers = collect(main, handleRe)
const mainIpcOn = collect(main, ipcOnRe)
const pushChannels = collect(pushSrc, pushRe)

// 已知豁免：主→渲染推送通道（无需 main handler）与菜单动作 payload
const EXEMPT = new Set([
  "menu-action", // 菜单渠道：main 经 webContents.send 发动作名
  "open-settings", // 菜单栏动作入口：ipcMain.handle 将动作经 menu-action 转发渲染端消费
  ...preloadListen,
])

// 缺口 1：preload invoke 无 main handler
const missing = [...preloadInvoke].filter((c) => !mainHandlers.has(c) && !mainIpcOn.has(c))

// 缺口 2：main 注册的会话/请求通道无 preload 消费（死通道报告；推送/菜单豁免）
const dead = [...mainHandlers].filter(
  (c) => !preloadInvoke.has(c) && !EXEMPT.has(c) && !pushChannels.has(c),
)

console.log(`preload invoke: ${preloadInvoke.size} · preload listen: ${preloadListen.size}`)
console.log(`main handlers: ${mainHandlers.size} · push channels: ${pushChannels.size}`)
console.log(`MISSING (preload invoke → 无 main handler): ${missing.length ? JSON.stringify(missing) : "0"}`)
console.log(`DEAD (main handler → 无 preload 消费): ${dead.length ? JSON.stringify(dead) : "0"}`)

if (missing.length > 0) {
  console.error("IPC CONSISTENCY FAIL: 存在 invoke 到未注册通道")
  process.exit(1)
}
console.log("IPC CONSISTENCY PASS")