import {
  collectVisibleDaveBackgroundTaskControlItems,
  getDaveBackgroundTaskControlItemElapsedMs,
  isActiveDaveBackgroundTaskControlItem,
  parseDaveBackgroundTaskControlItems,
  type DaveBackgroundTaskControlItem,
  type DaveBackgroundTaskControlStatus,
} from "./background-task-controls.js";

export type DaveBackgroundBashJobStatus = DaveBackgroundTaskControlStatus;
export type DaveBackgroundBashJob = DaveBackgroundTaskControlItem & {
  taskKind: "bash";
};

export function parseDaveBackgroundBashJobs(value: unknown): DaveBackgroundBashJob[] {
  return parseDaveBackgroundTaskControlItems(value).filter(isBackgroundBashJob);
}

export function isActiveDaveBackgroundBashJob(job: DaveBackgroundBashJob): boolean {
  return isActiveDaveBackgroundTaskControlItem(job);
}

export function getDaveBackgroundBashJobElapsedMs(
  job: DaveBackgroundBashJob,
  now = Date.now(),
): number {
  return getDaveBackgroundTaskControlItemElapsedMs(job, now);
}

export function collectVisibleDaveBackgroundBashJobs(
  jobs: readonly DaveBackgroundBashJob[],
  now = Date.now(),
  thresholdMs = 30_000,
): Array<DaveBackgroundBashJob & { elapsedMs: number }> {
  return collectVisibleDaveBackgroundTaskControlItems(jobs, now, thresholdMs) as Array<
    DaveBackgroundBashJob & { elapsedMs: number }
  >;
}

function isBackgroundBashJob(job: DaveBackgroundTaskControlItem): job is DaveBackgroundBashJob {
  return job.taskKind === "bash";
}
