// 扫描 src/renderer 中用户可见的硬编码中文(JSX 文本/属性),报告未迁移项。
// 用于验证 i18n 迁移完整性(0.3.0 M2):核心组件已迁移 t(),本脚本列出剩余候选。
// 纯 Node 脚本,无依赖。用法:node scripts/scan-hardcoded-zh.mjs
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import process from "node:process"

const ROOT = join(process.cwd(), "src", "renderer")
const files = []

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) {
      walk(p)
    } else if (/\.(tsx|ts)$/.test(entry)) {
      files.push(p)
    }
  }
}
walk(ROOT)

const zhRe = /[\u4e00-\u9fff]/
let issues = 0
for (const f of files) {
  const lines = readFileSync(f, "utf8").split("\n")
  lines.forEach((line, i) => {
    const t = line.trim()
    if (!zhRe.test(t)) return
    if (t.startsWith("//") || t.startsWith("*")) return
    if (t.startsWith("import ") || t.includes('from "')) return
    if (t.includes("t(")) return // 已迁移(useTranslation 调用)
    if (!/[<>"=]/.test(t)) return // 非 JSX 文本/属性
    process.stdout.write(`${f.split("renderer")[1]}:${i + 1}: ${t}\n`)
    issues++
  })
}
process.stdout.write(`\n剩余硬编码中文候选: ${issues} 处(核心组件已迁移,此为后续清单)\n`)
process.exit(issues > 0 ? 1 : 0)
