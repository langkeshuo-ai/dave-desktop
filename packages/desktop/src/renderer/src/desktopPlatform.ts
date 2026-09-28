import { recordArmsCustomEventForE2E } from "@dave/ui";
import { DesktopCommandIds, buildLocalMediaPreviewUrl, type IPlatformService } from "@dave/shared";

import { desktopBrowserPlatformBridge } from "./desktopBrowserPlatformBridge.js";

export function createDesktopPlatform(options: {
  isLocalDevelopmentRuntime: boolean;
}): IPlatformService {
  return {
    canSelectFilePath: true,
    createLocalMediaPreviewUrl: buildLocalMediaPreviewUrl,
    isLocalDevelopmentRuntime: options.isLocalDevelopmentRuntime,
    selectDirectory: () => window.dave.selectDirectory(),
    selectFile: () => window.dave.selectFile(),
    selectFiles: () => window.dave.selectFiles?.() ?? Promise.resolve([]),
    createTempTextAttachment: (payload) => window.dave.createTempTextAttachment(payload),
    onRemoteConnectionLog: (handler) => window.dave.onRemoteConnectionLog(handler),
    onRemoteSessionClosed: (handler) => window.dave.onRemoteSessionClosed(handler),
    onBotRemoteWorkspaceReconnected: (handler) =>
      window.dave.onBotRemoteWorkspaceReconnected(handler),
    activateOrSetWorkspace: (path) =>
      window.dave.activateOrSetWorkspace?.(path) ?? Promise.resolve({ activated: false }),
    connectRemote: (remoteOptions, requestId, context) =>
      window.dave.connectRemote(remoteOptions, requestId, context),
    cancelPendingRemoteConnection: (requestId) =>
      window.dave.cancelPendingRemoteConnection?.(requestId) ?? Promise.resolve(),
    bindRemoteWorkspaceSessionContext: (context) =>
      window.dave.bindRemoteWorkspaceSessionContext?.(context) ?? Promise.resolve(),
    disposeRemoteSession: (sessionId) => window.dave.disposeRemoteSession(sessionId),
    isDockerAvailable: () => window.dave.isDockerAvailable(),
    listWSLDistros: () => window.dave.listWSLDistros(),
    listDockerContainers: () => window.dave.listDockerContainers(),
    listSSHConfigAliases: () => window.dave.listSSHConfigAliases(),
    loadMcpFromUserDirectory: (payload) => window.dave.loadMcpFromUserDirectory(payload),
    saveMcpToUserDirectory: (payload) => window.dave.saveMcpToUserDirectory(payload),
    migrateLegacyCommonMcp: (payload) => window.dave.migrateLegacyCommonMcp(payload),
    openExternal: (url) => window.dave.openExternal(url),
    openFeedback: () => window.dave.executeDesktopCommand(DesktopCommandIds.OpenFeedback),
    openCommunity: () => window.dave.executeDesktopCommand(DesktopCommandIds.OpenCommunity),
    canOpenCommunity: (locale) => window.dave.canOpenCommunity(locale),
    openInFileManager: (path) => window.dave.openInFileManager(path),
    openExternalFile: (path) => window.dave.openExternalFile(path),
    openCuaPermissionOnboarding: window.dave.openCuaPermissionOnboarding
      ? (permissionOptions) =>
          window.dave.openCuaPermissionOnboarding?.(permissionOptions) ??
          Promise.resolve({ success: false, error: "not_supported" })
      : undefined,
    prepareCuaHelperPermissionDrag: window.dave.prepareCuaHelperPermissionDrag
      ? () =>
          window.dave.prepareCuaHelperPermissionDrag?.() ??
          Promise.resolve({ success: false, error: "not_supported" })
      : undefined,
    startCuaHelperPermissionDrag: window.dave.startCuaHelperPermissionDrag
      ? () => window.dave.startCuaHelperPermissionDrag?.()
      : undefined,
    registerOAuthState: (payload) => window.dave.registerOAuthState(payload),
    onOAuthCallback: (callback) => window.dave.onOAuthCallback(callback),
    onPaymentCallback: (callback) => window.dave.onPaymentCallback(callback),
    onShareImport: (callback) => window.dave.onShareImport?.(callback) ?? (() => {}),
    notifyRendererReady: () => window.dave.notifyRendererReady(),
    reportTelemetryEvent: (payload) => window.dave.reportTelemetryEvent(payload),
    reportArmsCustomEvent: (payload) => {
      recordArmsCustomEventForE2E(payload);
      return window.dave.reportArmsCustomEvent(payload);
    },
    getRendererActionTraceConfig: window.dave.getRendererActionTraceConfig
      ? () => window.dave.getRendererActionTraceConfig!()
      : undefined,
    onRendererActionTraceConfigChanged: window.dave.onRendererActionTraceConfigChanged
      ? (callback) => window.dave.onRendererActionTraceConfigChanged!(callback)
      : undefined,
    reportLocalTtftBatch: (batch) => window.dave.reportLocalTtftBatch(batch),
    reportRendererActionTraceBatch: window.dave.reportRendererActionTraceBatch
      ? (batch) => window.dave.reportRendererActionTraceBatch!(batch)
      : undefined,
    reportRendererHeapSample: window.dave.reportRendererHeapSample
      ? (sample) => window.dave.reportRendererHeapSample!(sample)
      : undefined,
    showTaskNotification: (payload) => window.dave.showTaskNotification(payload),
    syncWindowTabs: (paths) => window.dave.syncWindowTabs(paths),
    syncWindowUnreadCount: (count) => window.dave.syncWindowUnreadCount(count),
    syncActiveTaskSession: (sessionId) => window.dave.syncActiveTaskSession(sessionId),
    syncAppSettings: (patch) => window.dave.syncAppSettings?.(patch),
    setShortcutRecordingActive: (active) => window.dave.setShortcutRecordingActive?.(active),
    onFocusTab: (handler) => window.dave.onFocusTab(handler),
    onNewTab: (handler) => window.dave.onNewTab(handler),
    onCloseActiveContextRequest: (handler) =>
      window.dave.onCloseActiveContextRequest?.(handler) ?? (() => {}),
    onOpenBrowserUrl: (handler) => window.dave.onOpenBrowserUrl?.(handler) ?? (() => {}),
    onBrowserViewScreenshotSurfacePrepare: (handler) =>
      window.dave.onBrowserViewScreenshotSurfacePrepare?.(handler) ?? (() => {}),
    onBrowserViewScreenshotSurfaceRelease: (handler) =>
      window.dave.onBrowserViewScreenshotSurfaceRelease?.(handler) ?? (() => {}),
    browserViewScreenshotSurfaceReady: (payload) =>
      window.dave.browserViewScreenshotSurfaceReady?.(payload),
    ...desktopBrowserPlatformBridge,
    onNewTask: (handler) => window.dave.onNewTask(handler),
    onOpenWorkspace: (handler) => {
      // 开发态或升级后的旧窗口可能仍运行未暴露 onOpenWorkspace 的 preload，
      // renderer 直接调用会在启动时崩溃。这里和 activateOrSetWorkspace 一样做兼容兜底，
      // 缺少该 bridge 时只禁用原生菜单回调，不影响应用继续打开。
      return window.dave.onOpenWorkspace?.(handler) ?? (() => {});
    },
    onOpenWorkspacePath: (handler) => window.dave.onOpenWorkspacePath?.(handler) ?? (() => {}),
    onOpenFeedbackDialog: (handler) => window.dave.onOpenFeedbackDialog?.(handler) ?? (() => {}),
    onOpenTicketsPanel: (handler) => window.dave.onOpenTicketsPanel?.(handler) ?? (() => {}),
    onWindowFullscreenChanged: (handler) => window.dave.onWindowFullscreenChanged(handler),
    getDesktopWindowChromeState: window.dave.getDesktopWindowChromeState
      ? () => window.dave.getDesktopWindowChromeState!()
      : undefined,
    onDesktopWindowChromeStateChanged: window.dave.onDesktopWindowChromeStateChanged
      ? (handler) => window.dave.onDesktopWindowChromeStateChanged!(handler)
      : undefined,
    getWindowControlsOverlayMetrics: () => window.dave.getWindowControlsOverlayMetrics?.() ?? null,
    onWindowControlsOverlayChanged: (handler) =>
      window.dave.onWindowControlsOverlayChanged?.(handler) ?? (() => {}),
    getDesktopZoomLevel: () =>
      window.dave.getDesktopZoomLevel?.() ?? Promise.resolve({ zoomLevel: 0 }),
    onDesktopZoomLevelChanged: (handler) =>
      window.dave.onDesktopZoomLevelChanged?.(handler) ?? (() => {}),
    onTaskNotificationClick: (handler) => window.dave.onTaskNotificationClick(handler),
    exportLogs: () => window.dave.exportLogs(),
    captureWindowScreenshot: () =>
      window.dave.captureWindowScreenshot?.() ?? Promise.resolve(null),
    onUpdateReady: (callback) => window.dave.onUpdateReady(callback),
    onUpdateCheckResult: (callback) => window.dave.onUpdateCheckResult(callback),
    onUpdateStateChanged: (callback) => window.dave.onUpdateStateChanged?.(callback) ?? (() => {}),
    getUpdateState: () =>
      window.dave.getUpdateState?.() ?? Promise.resolve({ kind: "idle", enabled: true }),
    downloadUpdate: () => window.dave.downloadUpdate?.() ?? Promise.resolve(),
    cancelUpdateDownload: () => window.dave.cancelUpdateDownload?.() ?? Promise.resolve(),
    openUpdateStatusWindow: () => window.dave.openUpdateStatusWindow?.() ?? Promise.resolve(),
    getAutoUpdatePreferences: () =>
      window.dave.getAutoUpdatePreferences?.() ??
      Promise.resolve({ autoDownloadAndInstallUpdates: false }),
    setAutoDownloadAndInstallUpdates: (enabled) =>
      window.dave.setAutoDownloadAndInstallUpdates?.(enabled) ?? Promise.resolve(),
    getDesktopSessionActivity: () =>
      window.dave.getDesktopSessionActivity?.() ??
      Promise.resolve({ runningAgentSessionCount: 0 }),
    getDaveStdioTapDevState: () =>
      window.dave.getDaveStdioTapDevState?.() ??
      Promise.resolve({ enabled: false, visible: false, logDir: "", statePath: "" }),
    onSettingsChanged: (callback) => window.dave.onSettingsChanged?.(callback) ?? (() => {}),
    onApplicationLocaleChanged: (callback) =>
      window.dave.onApplicationLocaleChanged?.(callback) ?? (() => {}),
    onPostUpdateReleaseNotes: (callback) => window.dave.onPostUpdateReleaseNotes(callback),
    acknowledgePostUpdateReleaseNotes: (version) =>
      window.dave.acknowledgePostUpdateReleaseNotes(version),
    skipUpdateVersion: (version) => window.dave.skipUpdateVersion?.(version) ?? Promise.resolve(),
    quitAndInstallUpdate: () => window.dave.quitAndInstallUpdate(),
    getInstalledEditors: () => window.dave.getInstalledEditors(),
    getApplicationIcon: (bundleId) =>
      window.dave.getApplicationIcon?.(bundleId) ?? Promise.resolve(null),
    openInEditor: (editorId, path, editorOptions) =>
      window.dave.openInEditor(editorId, path, editorOptions),
    executeDesktopCommand: (command) => window.dave.executeDesktopCommand(command),
    setApplicationLocale: (locale) => window.dave.setApplicationLocale(locale),
    getSystemLocale: () =>
      window.dave.getSystemLocale?.() ??
      Promise.resolve(navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US"),
    setTitleBarTheme: (theme) => window.dave.setTitleBarTheme(theme),
    getDeviceId: () =>
      (window as Window & { __DAVE_DEVICE_ID__?: string }).__DAVE_DEVICE_ID__ ?? "",
  };
}
