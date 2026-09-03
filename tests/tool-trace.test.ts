import { describe, expect, it } from "vitest"
import {
  toToolTraceStatus,
  toToolTraces,
  toolTraceKey,
  type ToolTrace,
} from "../src/shared/tool-trace"

describe("toToolTraceStatus", () => {
  it("拒绝消息 → denied（主进程固定前缀『用户拒绝』）", () => {
    expect(toToolTraceStatus("用户拒绝了此操作（或会话已中止）")).toBe("denied")
    expect(toToolTraceStatus("用户拒绝")).toBe("denied")
  })

  it("失败消息 → failed（『工具失败』前缀）", () => {
    expect(toToolTraceStatus("工具失败：ENOENT no such file")).toBe("failed")
  })

  it("未知工具错误 → failed（『错误：』前缀）", () => {
    expect(toToolTraceStatus("错误：未知工具 foo")).toBe("failed")
  })

  it("普通工具输出 → ok", () => {
    expect(toToolTraceStatus("文件已写入：src/main.ts")).toBe("ok")
    expect(toToolTraceStatus("")).toBe("ok")
  })
})

describe("toToolTraces", () => {
  const msgs = [
    { name: "read_file", content: "file content" },
    { name: "apply_patch", content: "patched ok" },
  ]

  it("保持顺序并推断状态", () => {
    const traces = toToolTraces(msgs)
    expect(traces).toHaveLength(2)
    expect(traces[0]).toMatchObject<ToolTrace>({
      name: "read_file",
      content: "file content",
      status: "ok",
    })
    expect(traces[1].status).toBe("ok")
  })

  it("重复 (name, content) 幂等去重，保留首次出现", () => {
    const dup: typeof msgs = [...msgs, { name: "read_file", content: "file content" }]
    const traces = toToolTraces(dup)
    expect(traces).toHaveLength(2)
    expect(traces[0].name).toBe("read_file")
  })

  it("同工具不同输出不判重", () => {
    const traces = toToolTraces([
      { name: "list", content: "a" },
      { name: "list", content: "b" },
    ])
    expect(traces).toHaveLength(2)
  })

  it("超过 max 截断（默认 8）", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `t${i}`, content: `out ${i}` }))
    expect(toToolTraces(many).length).toBe(8)
  })

  it("缺 name 的消息回退为 tool", () => {
    const traces = toToolTraces([{ content: "x" }])
    expect(traces[0].name).toBe("tool")
  })

  it("空输入 → 空数组", () => {
    expect(toToolTraces([])).toEqual([])
  })
})

describe("toolTraceKey", () => {
  it("用 name::content 拼接", () => {
    expect(toolTraceKey({ name: "sh", content: "ok" })).toBe("sh::ok")
  })
})
