/* =========================================================================
   Locale(界面语言)——0.3.0 M2 i18n 第一步。

   支持语言白名单:i18next(开源优先已评估:MIT、活跃、文档全)接入后,
   渲染端 i18n 基础设施用本模块校验/持久化 locale。纯函数(node 可单测)。
   ========================================================================= */

export const SUPPORTED_LOCALES = ["zh-CN", "en"] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

/** 校验界面语言;合法返回 true(类型收窄为 Locale)。 */
export function validateLocale(v: unknown): v is Locale {
  return typeof v === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(v)
}

/** 默认语言(中文优先)。 */
export const DEFAULT_LOCALE: Locale = "zh-CN"
