import { z } from "zod";
import type { CommandAgentSource } from "./command-types.js";
import type { DaveProvider } from "./dave-task-types-core.js";

export const DAVE_AGENT_PROVIDER = "glm" satisfies DaveProvider;
export const DAVE_AGENT_PROVIDER_LABEL = "Dave Agent";
export const DAVE_COMMAND_AGENT_SOURCE = "daveAgent" satisfies CommandAgentSource;

export const daveAgentProviderSchema = z.literal(DAVE_AGENT_PROVIDER);

export const DAVE_COMMAND_AGENT_SOURCES = [
  DAVE_COMMAND_AGENT_SOURCE,
] as const satisfies readonly CommandAgentSource[];

export function normalizeAgentProviderToDaveAgent(
  _provider?: DaveProvider | null,
): DaveProvider {
  return DAVE_AGENT_PROVIDER;
}

export function isDaveAgentProvider(
  provider: DaveProvider | null | undefined,
): provider is typeof DAVE_AGENT_PROVIDER {
  return provider === DAVE_AGENT_PROVIDER;
}
