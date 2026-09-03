// FPS 真机采集脚本(FPS-REAL 关闭路径,R1)。
//
// 自动注入 2000 条混合消息 → 重载渲染 → 用 rAF 帧间隔测量滚动性能,
// 输出 avg / P50 / P95 / P99 与慢帧计数。不需要人工点 Gauge 按钮。
//
// 用法:node tests/electron-fps.mjs(需先 npm run build)
// 验收口径与 PERFORMANCE_REPORT.md 一致:avg >50fps、P95 <30ms、P99 <50ms。
import { _electron as electron } from "playwright"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import process from "node:process"
import { setTimeout as delay } from "node:timers/promises"

const electronPath = join(process.cwd(), "node_modules", "electron", "dist", "electron.exe")
const userDataDir = await mkdtemp(join(tmpdir(), "dave-fps-"))
const env = { ...process.env, DAVE_TEST_USER_DATA: userDataDir }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: electronPath, args: [process.cwd()], env })

/** 混合消息:70% 简单文本 + 15% 代码块 + 15% diff(与压测生成器口径一致)。 */
function makeMessages(count) {
  const msgs = []
  for (let i = 0; i < count; i++) {
    const mod = i % 10
    if (mod < 7) {
      msgs.push({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `第 ${i} 条简单消息 —— React 性能优化与虚拟列表实现细节讨论 ${i}`,
      })
    } else if (mod === 7) {
      msgs.push({
        role: "assistant",
        content:
          "```ts\nconst value = " + i + "\nexport function compute() {\n  return value * 2\n}\n```",
      })
    } else if (mod === 8) {
      msgs.push({
        role: "assistant",
        content:
          "@@ patch\n--- a/file.ts\n+++ b/file.ts\n@@ -1,1 +1,1 @@\n-const a = " +
          i +
          "\n+const a = " +
          (i + 1) +
          "\n",
      })
    } else {
      msgs.push({
        role: "assistant",
        content: "很长的一段多段落文本。".repeat(60) + i,
      })
    }
  }
  return msgs
}

try {
  const window = await app.firstWindow({ timeout: 45_000 })
  await window.waitForFunction("() => !!document.getElementById('root')?.childElementCount", null, {
    timeout: 20_000,
  })
  // 跳过首启引导/向导(与 smoke 一致)
  const welcome = window.getByRole("dialog", { name: "欢迎使用 Dave Desktop" })
  if (await welcome.isVisible().catch(() => false)) await window.keyboard.press("Escape")
  const wizard = window.getByRole("dialog").filter({ hasText: /API|密钥|Provider/i })
  if (
    await wizard
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    await window.keyboard.press("Escape")
    await delay(300)
  }

  // 注入 2000 条混合消息(新会话,unshift 到列表首位)
  const sid = await window.evaluate(async (msgs) => {
    const id = await window.dave.session.create()
    await window.dave.session.replaceMessages(id, msgs)
    return id
  }, makeMessages(2000))
  process.stdout.write(`injected 2000 messages into ${sid}\n`)

  // 重载:渲染端加载最新会话并渲染 2000 条(虚拟列表按需渲染)
  await window.reload()
  await window.waitForFunction(
    "() => { const el = document.querySelector('.chat-scroller'); return !!el && el.scrollHeight - el.clientHeight > 2000 }",
    null,
    { timeout: 30_000 },
  )
  await delay(1200)

  // 启动 rAF 帧计数器(evaluate 回调在页面上下文执行,浏览器全局走 globalThis
  // 以通过 Node 环境 ESLint no-undef)
  await window.evaluate(() => {
    window.__fpsFrames = []
    const loop = (t) => {
      window.__fpsFrames.push(t)
      window.__fpsRAF = globalThis.requestAnimationFrame(loop)
    }
    window.__fpsRAF = globalThis.requestAnimationFrame(loop)
  })

  // 定位滚动容器(虚拟列表的滚动元素)——ChatView 滚动区带稳定类 .chat-scroller
  const scroller = await window.evaluate(() => {
    const el = globalThis.document.querySelector(".chat-scroller")
    return el ? { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight } : null
  })
  process.stdout.write(`scroller: ${JSON.stringify(scroller)}\n`)

  // 向下滚两轮 + 回到顶部再滚一轮(模拟真实用户翻阅长会话)
  for (let round = 0; round < 10; round++) {
    await window.mouse.wheel(0, 3000)
    await delay(120)
  }
  await window.mouse.wheel(0, -30000)
  await delay(400)
  for (let round = 0; round < 10; round++) {
    await window.mouse.wheel(0, 3000)
    await delay(120)
  }
  await delay(400)

  // 停止并计算帧间隔统计
  const report = await window.evaluate(() => {
    globalThis.cancelAnimationFrame(window.__fpsRAF)
    const frames = window.__fpsFrames || []
    const deltas = []
    for (let i = 1; i < frames.length; i++) deltas.push(frames[i] - frames[i - 1])
    if (deltas.length === 0) return { error: "no frames captured" }
    const sorted = [...deltas].sort((a, b) => a - b)
    const pct = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
    const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length
    return {
      frames: deltas.length,
      avgFps: Math.round((1000 / avg) * 10) / 10,
      p50: Math.round(pct(0.5) * 10) / 10,
      p95: Math.round(pct(0.95) * 10) / 10,
      p99: Math.round(pct(0.99) * 10) / 10,
      slow17: deltas.filter((d) => d > 16.7).length,
      slow33: deltas.filter((d) => d > 33.3).length,
      slow50: deltas.filter((d) => d > 50).length,
    }
  })
  process.stdout.write("FPS-REPORT: " + JSON.stringify(report) + "\n")
} finally {
  await app.close().catch(() => {})
  await rm(userDataDir, { recursive: true, force: true })
}
