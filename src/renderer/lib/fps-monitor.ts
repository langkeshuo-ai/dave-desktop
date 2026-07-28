import { calculateFpsStats, type FpsStats } from "../../shared/fps-stats"

export class FpsMonitor {
  private frameTimes: number[] = []
  private rafId: number | null = null
  private startTime = 0
  private lastTime = 0

  start(): void {
    if (this.rafId !== null) return
    this.frameTimes = []
    this.startTime = performance.now()
    this.lastTime = this.startTime

    const tick = () => {
      const now = performance.now()
      const delta = now - this.lastTime
      if (delta > 0) this.frameTimes.push(delta)
      this.lastTime = now
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  stop(): void {
    if (this.rafId === null) return
    cancelAnimationFrame(this.rafId)
    this.rafId = null
  }

  getStats(): FpsStats {
    return calculateFpsStats(this.frameTimes)
  }

  reset(): void {
    this.stop()
    this.frameTimes = []
    this.startTime = 0
    this.lastTime = 0
  }

  printReport(label = "FPS Report"): void {
    const stats = this.getStats()
    console.group(label)
    console.log(`Duration: ${(stats.durationMs / 1000).toFixed(2)}s`)
    console.log(`Frames: ${stats.total}`)
    console.log(`Average FPS: ${stats.avg.toFixed(1)}`)
    console.log(`FPS range: ${stats.min.toFixed(1)} - ${stats.max.toFixed(1)}`)
    console.log(
      `Frame time P50/P95/P99: ${stats.p50FrameMs.toFixed(1)} / ${stats.p95FrameMs.toFixed(1)} / ${stats.p99FrameMs.toFixed(1)}ms`,
    )
    console.log(
      `Slow frames >16.7/>33.3/>50ms: ${stats.over16Ms}/${stats.over33Ms}/${stats.over50Ms}`,
    )
    console.log(`Stutter rate (>33.3ms): ${stats.stutterRate.toFixed(1)}%`)
    console.groupEnd()
  }
}
