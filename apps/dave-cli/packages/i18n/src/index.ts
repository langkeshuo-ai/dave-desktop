import type { UiLocale, SupportedLocale } from "@dave/contracts";
import { enUS } from "./locales/en-US.js";
import { zhCN } from "./locales/zh-CN.js";
import {
  DEFAULT_LOCALE,
  detectLocale,
  isSupportedLocale,
  isUiLocale,
  resolveLocale,
  SUPPORTED_LOCALES,
} from "./locale.js";
import type { DaveCopy } from "./types.js";

export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  detectLocale,
  isSupportedLocale,
  isUiLocale,
  resolveLocale,
};
export type { LocaleDetectionInput } from "./locale.js";
export type { CliCopy, TuiCopy, UiLocale, SupportedLocale, DaveCopy } from "./types.js";

const CATALOGS: Record<SupportedLocale, DaveCopy> = {
  "en-US": enUS,
  "zh-CN": zhCN,
};

export function getDaveCopy(locale?: UiLocale | string, detected?: string | null): DaveCopy {
  return CATALOGS[resolveLocale(locale, detected)];
}
