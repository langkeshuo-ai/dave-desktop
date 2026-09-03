/**
 * 导出会话 Markdown（renderer 侧下载）：调 window.dave.session.exportMarkdown
 * 拿主进程生成的文本，Blob 下载为 .md 文件。供 ChatView 工具栏与命令面板复用。
 */
export async function exportSessionMarkdown(id: string, filename?: string): Promise<void> {
  const md = await window.dave?.session?.exportMarkdown(id)
  if (!md) return
  const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }))
  const a = document.createElement("a")
  a.href = url
  a.download = filename || `${id}.md`
  a.click()
  URL.revokeObjectURL(url)
}
