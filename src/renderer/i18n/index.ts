/* =========================================================================
   i18n 基础设施(0.3.0 M2 i18n 第一步)——基于 i18next(开源优先已评估:
   MIT、活跃维护、文档全)。

   职责:
   - 初始化 i18next + react-i18next(幂等)
   - zh-CN / en 翻译资源(与 shared/locale.ts 的 SUPPORTED_LOCALES 对齐)
   - 运行时切换语言(changeLocale;持久化由调用方写 store "locale")
   ========================================================================= */

import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import { DEFAULT_LOCALE, type Locale } from "../../shared/locale"

/** 翻译资源:与 SUPPORTED_LOCALES 对齐;zh-CN 与 en 的 key 必须一致(单测校验)。 */
export const resources = {
  "zh-CN": {
    translation: {
      settings: {
        title: "设置",
        section: {
          provider: "模型与密钥",
          workspace: "工作区与启动",
          extensions: "扩展与 MCP",
          about: "关于",
        },
        tabs: {
          provider: "模型",
          workspace: "工作区",
          extensions: "扩展",
          about: "关于",
        },
        language: "界面语言",
      },
    },
  },
  en: {
    translation: {
      settings: {
        title: "Settings",
        section: {
          provider: "Models & Keys",
          workspace: "Workspace & Startup",
          extensions: "Extensions & MCP",
          about: "About",
        },
        tabs: {
          provider: "Models",
          workspace: "Workspace",
          extensions: "Extensions",
          about: "About",
        },
        language: "Language",
      },
    },
  },
} as const

let initialized = false

/** 初始化 i18next(幂等)。locale 非法时回退默认。 */
export function initI18n(): void {
  if (initialized) return
  initialized = true
  void i18n.use(initReactI18next).init({
    resources,
    lng: DEFAULT_LOCALE,
    fallbackLng: DEFAULT_LOCALE,
    interpolation: { escapeValue: false },
  })
}

/** 运行时切换界面语言(不持久化;持久化由调用方写 store "locale")。 */
export function changeLocale(locale: Locale): void {
  if (i18n.isInitialized) void i18n.changeLanguage(locale)
}
