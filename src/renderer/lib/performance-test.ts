import { FpsMonitor } from "./fps-monitor"
import { generateMixedTestMessages } from "./test-utils"

export function createVirtualScrollTest(count = 2000) {
  return {
    messages: generateMixedTestMessages(count),
    monitor: new FpsMonitor(),
  }
}
