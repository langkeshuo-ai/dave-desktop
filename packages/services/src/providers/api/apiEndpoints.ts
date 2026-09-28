import { buildRuntimeDaveApiUrl, resolveZaiBusinessBaseUrl } from "@dave/shared";

export const DAVE_CLIENT_SCENES_URL = buildRuntimeDaveApiUrl(
  process.env,
  "/api/v1/client/scenes",
);

export const ZAI_API_HOST = resolveZaiBusinessBaseUrl(process.env);
