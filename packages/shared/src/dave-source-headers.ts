import { DEFAULT_DAVE_ENDPOINT_ORIGIN } from "./daveEndpoint.js";

export const DAVE_SOURCE_HEADERS = {
  "User-Agent": "Dave/unknown",
  "HTTP-Referer": DEFAULT_DAVE_ENDPOINT_ORIGIN,
  "X-Title": "Z Code@electron",
} as const;

export interface BuildDaveSourceHeadersFromContextOptions {
  appVersion?: string;
  arch?: string;
  clientLanguage?: string;
  clientTimezone?: string;
  deviceMid?: string;
  endpointOrigin?: string;
  osVersion?: string;
  platform?: string;
  releaseChannel?: string;
  sourceTitle?: string;
}

export function normalizeDaveSourceHeaderValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^[\x20-\x7e]+$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function buildDaveSourceHeadersFromContext(
  options: BuildDaveSourceHeadersFromContextOptions = {},
): Record<string, string> {
  const appVersion = normalizeDaveSourceHeaderValue(options.appVersion);
  const arch = normalizeDaveSourceHeaderValue(options.arch);
  const clientLanguage = normalizeDaveSourceHeaderValue(options.clientLanguage) ?? "unknown";
  const clientTimezone = normalizeDaveSourceHeaderValue(options.clientTimezone) ?? "unknown";
  const deviceMid = normalizeDaveSourceHeaderValue(options.deviceMid);
  const endpointOrigin =
    normalizeDaveSourceHeaderValue(options.endpointOrigin) ?? DEFAULT_DAVE_ENDPOINT_ORIGIN;
  const osVersion = normalizeDaveSourceHeaderValue(options.osVersion);
  const platform = normalizeDaveSourceHeaderValue(options.platform);
  const releaseChannel = normalizeDaveSourceHeaderValue(options.releaseChannel);
  const sourceTitle = normalizeDaveSourceHeaderValue(options.sourceTitle) ?? "electron";

  return {
    ...DAVE_SOURCE_HEADERS,
    "HTTP-Referer": endpointOrigin,
    "User-Agent": `Dave/${appVersion ?? "unknown"}`,
    ...(appVersion ? { "X-Dave-App-Version": appVersion } : {}),
    "X-Title": `Z Code@${sourceTitle}`,
    ...(platform && arch ? { "X-Platform": `${platform}-${arch}` } : {}),
    ...(releaseChannel ? { "X-Release-Channel": releaseChannel } : {}),
    "X-Client-Language": clientLanguage,
    "X-Client-Timezone": clientTimezone,
    ...(platform ? { "X-Os-Category": normalizeOsCategory(platform) } : {}),
    ...(osVersion ? { "X-Os-Version": osVersion } : {}),
    ...(deviceMid ? { "X-Device-Mid": deviceMid } : {}),
  };
}

function normalizeOsCategory(platform: string): string {
  switch (platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return "linux";
  }
}
