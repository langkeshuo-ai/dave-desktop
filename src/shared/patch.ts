/* =========================================================================
   Unified-diff parse + apply + UI rows.
   Reuses npm `diff` (BSD-3-Clause, actively maintained) for parse/apply.
   ========================================================================= */

import {
  applyPatch as libApplyPatch,
  parsePatch as libParsePatch,
  type StructuredPatch,
} from "diff"

export interface DiffRow {
  type: "add" | "del" | "context" | "hunk" | "meta"
  oldNum?: string
  newNum?: string
  text: string
}

export interface PatchFileView {
  path: string
  rows: DiffRow[]
}

export interface ParsedPatchFile {
  path: string
  oldPath?: string
  /** Original structured patch from `diff` package (for apply). */
  structured: StructuredPatch
}

/** Normalize codex-style `@@ patch` / `*** Begin Patch` wrappers into unified-diff. */
export function normalizePatchBody(body: string): string {
  let text = body.replace(/\r\n/g, "\n")
  if (text.startsWith("@@ patch")) {
    text = text.replace(/^@@ patch\s*\n?/, "")
  }
  // Drop codex begin/end markers that confuse pure unified parsers.
  text = text
    .split("\n")
    .filter(
      (l) =>
        !l.startsWith("*** Begin Patch") &&
        !l.startsWith("*** End Patch") &&
        !l.startsWith("*** Update File:") &&
        !l.startsWith("*** Add File:") &&
        !l.startsWith("*** Delete File:"),
    )
    .join("\n")
  return text.trim() + "\n"
}

/** Parse unified-diff into per-file structured patches. Throws if empty. */
export function parseUnifiedPatch(body: string): ParsedPatchFile[] {
  const normalized = normalizePatchBody(body)
  const patches = libParsePatch(normalized)
  const files: ParsedPatchFile[] = []
  for (const p of patches) {
    const newName = (p.newFileName || p.oldFileName || "").replace(/^[ab]\//, "")
    if (!newName || newName === "/dev/null") continue
    files.push({
      path: newName,
      oldPath: p.oldFileName?.replace(/^[ab]\//, ""),
      structured: p,
    })
  }
  if (files.length === 0) {
    throw new Error("patch 解析失败：未识别任何文件头（需要 --- / +++ 与 @@ hunk）")
  }
  return files
}

/**
 * Apply a single structured patch to source text.
 * Multi-hunk is handled by the `diff` library (not our broken splice).
 */
export function applyPatchToText(source: string, structured: StructuredPatch): string {
  if (!structured || typeof structured !== "object") {
    throw new Error(`patch 应用失败：缺少结构化 patch（structured=${typeof structured}）`)
  }
  // libApplyPatch returns false on failure in some versions; string on success.
  const result = libApplyPatch(source, structured)
  if (result === false || result == null) {
    throw new Error(
      `patch 应用失败：${structured.newFileName || structured.oldFileName || "unknown"}`,
    )
  }
  return result
}

/** Build UI diff rows from a unified-diff body (renderer). */
export function parsePatchForView(body: string): { files: PatchFileView[] } {
  const lines = normalizePatchBody(body).split("\n")
  const files: PatchFileView[] = []
  let current: PatchFileView | null = null
  let oldNo = 0
  let newNo = 0

  for (const line of lines) {
    if (line.trim() === "") continue
    if (line.startsWith("diff --git")) continue
    if (line.startsWith("index ") || line.startsWith("similarity ")) continue

    if (line.startsWith("--- ")) {
      const oldP = line
        .slice(4)
        .trim()
        .replace(/^[ab]\//, "")
      current = { path: oldP === "/dev/null" ? "" : oldP, rows: [{ type: "meta", text: line }] }
      files.push(current)
      continue
    }
    if (line.startsWith("+++ ")) {
      const newP = line
        .slice(4)
        .trim()
        .replace(/^[ab]\//, "")
      if (current) {
        if (newP && newP !== "/dev/null") current.path = newP
        current.rows.push({ type: "meta", text: line })
      } else {
        current = { path: newP, rows: [{ type: "meta", text: line }] }
        files.push(current)
      }
      continue
    }
    if (line.startsWith("@@")) {
      current?.rows.push({ type: "hunk", text: line })
      const m = line.match(/@@\s*-(\d+)(?:,\d+)?\s*\+(\d+)(?:,\d+)?\s*@@/)
      if (m) {
        oldNo = parseInt(m[1], 10)
        newNo = parseInt(m[2], 10)
      }
      continue
    }
    if (!current) continue
    if (line.startsWith("+")) {
      current.rows.push({ type: "add", newNum: String(newNo++), text: line.slice(1) })
    } else if (line.startsWith("-")) {
      current.rows.push({ type: "del", oldNum: String(oldNo++), text: line.slice(1) })
    } else if (line.startsWith("\\")) {
      current.rows.push({ type: "meta", text: line })
    } else {
      const text = line.startsWith(" ") ? line.slice(1) : line
      current.rows.push({
        type: "context",
        oldNum: String(oldNo++),
        newNum: String(newNo++),
        text,
      })
    }
  }
  return { files: files.filter((f) => f.path) }
}
