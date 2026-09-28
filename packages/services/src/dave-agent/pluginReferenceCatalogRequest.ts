import {
  daveProtocolMethods,
  davePluginsReferenceCatalogResultSchema,
  type DavePluginsReferenceCatalogParams,
} from "@dave/shared";
import type { DaveProtocolClient } from "#src/dave-agent/daveProtocolClient.js";

/** 旧协议严格校验响应；新展示字段走独立入口，只有 -32601 能证明旧 Agent 不支持。 */
export async function requestPluginReferenceCatalog(
  client: Pick<DaveProtocolClient, "request">,
  params: DavePluginsReferenceCatalogParams,
) {
  try {
    return await client.request(
      daveProtocolMethods.pluginsReferenceCatalogWithCategory,
      params,
      davePluginsReferenceCatalogResultSchema,
    );
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === -32601))
      throw error;
    return client.request(
      daveProtocolMethods.pluginsReferenceCatalog,
      params,
      davePluginsReferenceCatalogResultSchema,
    );
  }
}
