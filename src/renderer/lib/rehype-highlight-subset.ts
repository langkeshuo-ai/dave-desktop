/* =========================================================================
   轻量语法高亮 rehype 插件 —— Markdown chunk 瘦身(R4)。

   为什么不用 rehype-highlight:
   - rehype-highlight 顶层 `import { common } from "lowlight"` 且回退为
     `settings.languages || common`,Rollup 无法静态证明 languages 恒传入,
     因此 `common`(~37 种语言语法)永远无法被摇树,chunk 体积锁定在 ~738KB。
   - 本插件用 `createLowlight()`(空实例)只注册实际需要的语言子集,
     未注册语言静默回退为纯文本(不报错、不刷 console 警告)。

   行为与 rehype-highlight 对齐:
   - 只处理 `pre > code` 结构,读取 `language-*` / `lang-*` class。
   - `no-highlight` / `nohighlight` class 跳过。
   - 输出加 `hljs` class,内部 span 沿用 `hljs-*` 前缀,与 globals.css 主题一致。
   ========================================================================= */

import type { Root, Element, ElementContent } from "hast"
import type { Plugin } from "unified"
import { visit } from "unist-util-visit"
import { toText } from "hast-util-to-text"
import { createLowlight } from "lowlight"
import type { LanguageFn } from "lowlight"

import bash from "highlight.js/lib/languages/bash"
import c from "highlight.js/lib/languages/c"
import cpp from "highlight.js/lib/languages/cpp"
import css from "highlight.js/lib/languages/css"
import diff from "highlight.js/lib/languages/diff"
import dockerfile from "highlight.js/lib/languages/dockerfile"
import go from "highlight.js/lib/languages/go"
import ini from "highlight.js/lib/languages/ini"
import java from "highlight.js/lib/languages/java"
import javascript from "highlight.js/lib/languages/javascript"
import json from "highlight.js/lib/languages/json"
import markdown from "highlight.js/lib/languages/markdown"
import php from "highlight.js/lib/languages/php"
import powershell from "highlight.js/lib/languages/powershell"
import python from "highlight.js/lib/languages/python"
import rust from "highlight.js/lib/languages/rust"
import sql from "highlight.js/lib/languages/sql"
import typescript from "highlight.js/lib/languages/typescript"
import xml from "highlight.js/lib/languages/xml"
import yaml from "highlight.js/lib/languages/yaml"

/** 规范语言名 → 语法模块(只注册这 20 种,未列出的语言回退纯文本)。 */
const HIGHLIGHT_LANGUAGES: Record<string, LanguageFn> = {
  bash,
  c,
  cpp,
  css,
  diff,
  dockerfile,
  go,
  ini,
  java,
  javascript,
  json,
  markdown,
  php,
  powershell,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
}

/** 常见别名(与 highlight.js 内置 alias 对齐)。 */
const HIGHLIGHT_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  py: "python",
  html: "xml",
  svg: "xml",
  md: "markdown",
  yml: "yaml",
  toml: "ini",
  conf: "ini",
  "c++": "cpp",
  "h++": "cpp",
  golang: "go",
  ps1: "powershell",
  ps: "powershell",
  docker: "dockerfile",
  containerfile: "dockerfile",
}

const lowlight = createLowlight(HIGHLIGHT_LANGUAGES)
lowlight.registerAlias(HIGHLIGHT_ALIASES)

const HLJS_CLASS = "hljs"
const PREFIX = "hljs-"

/** 提取 `language-*` / `lang-*` 语言名;`no-highlight` 返回 false。 */
function languageOf(node: Element): false | string | undefined {
  const list = node.properties?.className
  if (!Array.isArray(list)) return undefined
  let name: string | undefined
  for (const value of list) {
    const cls = String(value)
    if (cls === "no-highlight" || cls === "nohighlight") return false
    if (!name && cls.startsWith("lang-")) name = cls.slice("lang-".length)
    if (!name && cls.startsWith("language-")) name = cls.slice("language-".length)
  }
  return name
}

/**
 * 变换器:遍历 `pre > code`,用 lowlight 子集做高亮。
 * 未注册语言或高亮异常时保持原样(纯文本),不抛错。
 */
const transformer = (tree: Root): void => {
  visit(tree, "element", (node, _index, parent) => {
    if (
      node.tagName !== "code" ||
      !parent ||
      parent.type !== "element" ||
      parent.tagName !== "pre"
    ) {
      return
    }
    const lang = languageOf(node)
    if (lang === false) return

    const className: string[] = Array.isArray(node.properties?.className)
      ? node.properties.className
      : []
    if (!className.includes(HLJS_CLASS)) className.unshift(HLJS_CLASS)

    let result: Root | undefined
    try {
      result = lang
        ? lowlight.highlight(lang, toText(node, { whitespace: "pre" }), { prefix: PREFIX })
        : undefined
    } catch {
      // 未知语言 / 非法语法 —— 保持纯文本,不打断渲染。
      return
    }
    if (!result || result.children.length === 0) return

    node.properties = { ...node.properties, className }
    node.children = result.children as ElementContent[]
  })
}

/** 导出为 unified Plugin,供 rehypePlugins 使用。
 *  显式泛型 <[], Root, Root>:rehype-sanitize@6 同款问题,unified Plugin
 *  默认 Transformer<Node, Node> 与我们的 (tree: Root) => void 不兼容。 */
const rehypeHighlightSubset: Plugin<[], Root, Root> = () => transformer
export default rehypeHighlightSubset
