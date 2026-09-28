import { getDaveCopy, type SupportedLocale, type UiLocale } from "@dave/i18n";

export function formatCliHelp(
  version: string,
  locale?: UiLocale,
  detectedLocale?: SupportedLocale,
): string {
  return getDaveCopy(locale, detectedLocale).cli.help(version);
}
