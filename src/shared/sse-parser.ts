export const MAX_SSE_EVENT_CHARS = 256_000

export type SseEvent = { data: string }

export class SseParser {
  private buffer = ""
  private dataLines: string[] = []

  push(chunk: string, flush = false): SseEvent[] {
    this.buffer += chunk
    if (this.buffer.length > MAX_SSE_EVENT_CHARS) throw new Error("SSE 事件超过大小限制")

    const events: SseEvent[] = []
    const lines = this.buffer.split(/\r?\n/)
    this.buffer = flush ? "" : (lines.pop() ?? "")

    for (const line of lines) this.consumeLine(line, events)
    if (flush) {
      if (this.buffer) this.consumeLine(this.buffer, events)
      this.emit(events)
    }
    return events
  }

  private consumeLine(line: string, events: SseEvent[]): void {
    if (line === "") {
      this.emit(events)
      return
    }
    if (line.startsWith(":")) return
    const separator = line.indexOf(":")
    const field = separator === -1 ? line : line.slice(0, separator)
    let value = separator === -1 ? "" : line.slice(separator + 1)
    if (value.startsWith(" ")) value = value.slice(1)
    if (field === "data") {
      this.dataLines.push(value)
      if (this.dataLines.join("\n").length > MAX_SSE_EVENT_CHARS) {
        throw new Error("SSE data 超过大小限制")
      }
    }
  }

  private emit(events: SseEvent[]): void {
    if (this.dataLines.length === 0) return
    events.push({ data: this.dataLines.join("\n") })
    this.dataLines = []
  }
}
