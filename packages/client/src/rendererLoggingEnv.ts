type RendererImportMetaEnv = {
  readonly PROD?: boolean;
};

export function isRendererProductionBuild(): boolean {
  const rendererLoggingDisabled =
    (
      globalThis as typeof globalThis & {
        __DAVE_RENDERER_DISABLE_LOGGING__?: boolean;
      }
    ).__DAVE_RENDERER_DISABLE_LOGGING__ === true;
  return (
    rendererLoggingDisabled ||
    ((import.meta as ImportMeta & { env?: RendererImportMetaEnv }).env ?? {}).PROD === true
  );
}
