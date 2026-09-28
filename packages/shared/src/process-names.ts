const DAVE_PROCESS_PREFIX = "dave";
const MAX_PROCESS_NAME_SEGMENT_LENGTH = 24;

function sanitizeProcessNameSegment(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, MAX_PROCESS_NAME_SEGMENT_LENGTH);
}

function joinDaveProcessName(...segments: Array<string | null | undefined>): string {
  const sanitizedSegments = segments
    .map((segment) => sanitizeProcessNameSegment(segment))
    .filter((segment): segment is string => Boolean(segment));
  return [DAVE_PROCESS_PREFIX, ...sanitizedSegments].join("-");
}

function pickWorkspaceTag(workspacePath: string | null | undefined): string | undefined {
  const trimmedPath = workspacePath?.trim();
  if (!trimmedPath) {
    return undefined;
  }

  const parts = trimmedPath.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? trimmedPath;
}

export function formatDaveMainProcessName(): string {
  return joinDaveProcessName("main");
}

export function formatDaveGpuProcessName(): string {
  return joinDaveProcessName("gpu");
}

export function formatDaveHostProcessName(label?: string): string {
  return joinDaveProcessName("host", label);
}

export function formatDaveRendererProcessName(windowTitle?: string): string {
  const normalizedTitle = windowTitle?.trim();
  if (!normalizedTitle || normalizedTitle === "Dave") {
    return joinDaveProcessName("renderer", "main");
  }

  if (normalizedTitle === "Resource Manager") {
    return joinDaveProcessName("renderer", "resource-manager");
  }

  const remoteWindowPrefix = "Dave - ";
  if (normalizedTitle.startsWith(remoteWindowPrefix)) {
    return joinDaveProcessName(
      "renderer",
      "remote",
      normalizedTitle.slice(remoteWindowPrefix.length),
    );
  }

  return joinDaveProcessName("renderer", normalizedTitle);
}

export function formatDaveAgentProcessName(provider: string, workspacePath?: string): string {
  return joinDaveProcessName("agent", provider, pickWorkspaceTag(workspacePath));
}

export function formatDaveUtilityProcessName(name?: string, type = "utility"): string {
  return joinDaveProcessName(type, name);
}
