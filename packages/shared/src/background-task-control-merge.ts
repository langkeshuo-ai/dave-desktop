import type { DaveBackgroundTaskControlItem } from "./background-task-controls.js";

export function mergeDaveBackgroundTaskControlItems(
  current: readonly DaveBackgroundTaskControlItem[],
  updates: readonly DaveBackgroundTaskControlItem[],
): DaveBackgroundTaskControlItem[] {
  const jobsById = new Map(current.map((job) => [job.jobId, job] as const));
  for (const job of updates) {
    jobsById.set(job.jobId, job);
  }
  return Array.from(jobsById.values());
}
