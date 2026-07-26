/* =========================================================================
   FPS Monitor — 帧率监控工具，用于性能测试
   用于虚拟滚动压测场景，测量滚动/流式渲染时的帧率
   ========================================================================= */

export interface FpsStats {
  avg: number // 平均帧率
  min: number // 最低帧率
  max: number // 最高帧率
  stutters: number // 卡顿帧数（<30fps）
  total: number // 总帧数
  stutterRate: number // 卡顿率（%）
}

export class FpsMonitor {
  private frames: number[] = []
  private rafId: number | null = null
  private startTime: number = 0
  private lastTime: number = 0

  /** 开始监控帧率 */
  start(): void {
    if (this.rafId !== null) {
      console.warn("FpsMonitor already running")
      return
    }

    this.frames = []
    this.startTime = performance.now()
    this.lastTime = this.startTime

    const tick = () => {
      const now = performance.now()
      const delta = now - this.lastTime

      if (delta > 0) {
        const fps = 1000 / delta
        this.frames.push(fps)
      }

      this.lastTime = now
      this.rafId = requestAnimationFrame(tick)
    }

    this.rafId = requestAnimationFrame(tick)
  }

  /** 停止监控 */
  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  /** 获取统计数据 */
  getStats(): FpsStats {
    if (this.frames.length === 0) {
      return { avg: 0, min: 0, max: 0, stutters: 0, total: 0, stutterRate: 0 }
    }

    const total = this.frames.length
    const sum = this.frames.reduce((a, b) => a + b, 0)
    const avg = sum / total
    const min = Math.min(...this.frames)
    const max = Math.max(...this.frames)
    const stutters = this.frames.filter((f) => f < 30).length
    const stutterRate = (stutters / total) * 100

    return { avg, min, max, stutters, total, stutterRate }
  }

  /** 重置监控数据 */
  reset(): void {
    this.stop()
    this.frames = []
    this.startTime = 0
    this.lastTime = 0
  }

  /** 打印统计报告到控制台 */
  printReport(label: string = "FPS Report"): void {
    const stats = this.getStats()
    const duration = ((this.lastTime - this.startTime) / 1000).toFixed(2)

    console.group(`📊 ${label}`)
    console.log(`Duration: ${duration}s`)
    console.log(`Frames: ${stats.total}`)
    console.log(`Avg FPS: ${stats.avg.toFixed(1)}`)
    console.log(`Min FPS: ${stats.min.toFixed(1)}`)
    console.log(`Max FPS: ${stats.max.toFixed(1)}`)
    console.log(`Stutters (<30fps): ${stats.stutters} (${stats.stutterRate.toFixed(1)}%)`)

    if (stats.avg >= 55 && stats.min >= 40 && stats.stutterRate < 2) {
      console.log("✅ Performance: EXCELLENT")
    } else if (stats.avg >= 50 && stats.min >= 30 && stats.stutterRate < 5) {
      console.log("✅ Performance: GOOD")
    } else {
      console.log("⚠️ Performance: NEEDS OPTIMIZATION")
    }

    console.groupEnd()
  }
}
