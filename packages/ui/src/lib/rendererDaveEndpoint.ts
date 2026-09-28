import {
  buildRuntimeDaveEndpointUrls,
  DAVE_ENV,
  type RuntimeDaveEndpointEnv,
} from "@dave/shared";

interface RendererImportMetaEnv {
  VITE_DAVE_BASE_URL?: string;
  VITE_DAVE_ENDPOINT_ORIGIN?: string;
}

function readRendererImportMetaEnv(): RendererImportMetaEnv {
  return ((import.meta as ImportMeta & { env?: RendererImportMetaEnv }).env ??
    {}) as RendererImportMetaEnv;
}

function createRendererDaveEndpointEnv(
  env: RendererImportMetaEnv = readRendererImportMetaEnv(),
): RuntimeDaveEndpointEnv {
  return {
    DAVE_ENV,
    // UI 侧的 dave-plan 占位 provider 以前只看 DAVE_ENV，
    // 没有消费 Vite 注入的 base url，导致自定义测试域名时 renderer 和 host/service 可能不一致。
    DAVE_BASE_URL: env.VITE_DAVE_BASE_URL,
    DAVE_ENDPOINT_ORIGIN: env.VITE_DAVE_ENDPOINT_ORIGIN,
  };
}

export const RENDERER_DAVE_ENDPOINT_URLS = buildRuntimeDaveEndpointUrls(
  createRendererDaveEndpointEnv(),
);
