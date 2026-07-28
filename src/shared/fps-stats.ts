export interface FpsStats {
  avg: number
  min: number
  max: number
  total: number
  durationMs: number
  p50FrameMs: number
  p95FrameMs: number
  p99FrameMs: number
  over16Ms: number
  over33Ms: number
  over50Ms: number
  stutterRate: number
}

function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))]
}

export function calculateFpsStats(frameTimes: readonly number[]): FpsStats {
  const empty: FpsStats = {
    avg: 0,
    min: 0,
    max: 0,
    total: 0,
    durationMs: 0,
    p50FrameMs: 0,
    p95FrameMs: 0,
    p99FrameMs: 0,
    over16Ms: 0,
    over33Ms: 0,
    over50Ms: 0,
    stutterRate: 0,
  }
  if (frameTimes.length === 0) return empty

  const validFrameTimes = frameTimes.filter(
    (frameTime) => Number.isFinite(frameTime) && frameTime > 0,
  )
  if (validFrameTimes.length === 0) return empty

  const sorted = [...validFrameTimes].sort((a, b) => a - b)
  const durationMs = validFrameTimes.reduce((sum, frameTime) => sum + frameTime, 0)
  const total = validFrameTimes.length
  const over16Ms = validFrameTimes.filter((ms) => ms > 1000 / 60).length
  const over33Ms = validFrameTimes.filter((ms) => ms > 1000 / 30).length
  const over50Ms = validFrameTimes.filter((ms) => ms > 50).length

  return {
    avg: (total * 1000) / durationMs,
    min: 1000 / sorted[sorted.length - 1],
    max: 1000 / sorted[0],
    total,
    durationMs,
    p50FrameMs: percentile(sorted, 0.5),
    p95FrameMs: percentile(sorted, 0.95),
    p99FrameMs: percentile(sorted, 0.99),
    over16Ms,
    over33Ms,
    over50Ms,
    stutterRate: (over33Ms / total) * 100,
  }
}
