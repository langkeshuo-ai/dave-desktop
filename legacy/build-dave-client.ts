/**
 * 试验区转发脚本：真正构建入口在 packages/opencode/script/build-dave-client.ts。
 * 勿在本目录复制维护第二套 build 逻辑（易与主线 channel/worker 定义漂移）。
 *
 * 用法（在 monorepo 任意处）:
 *   bun run packages/opencode/script/build-dave-client.ts
 * 或从本文件:
 *   bun run build-dave-client.ts
 */
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const real = path.resolve(here, "../packages/opencode/script/build-dave-client.ts")
console.log(`→ forwarding to ${real}`)
await import(real)
