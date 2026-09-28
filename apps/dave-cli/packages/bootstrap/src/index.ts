// Bootstrap public API surface.

export * from "./app/create-app.js";
export type {
  ListDaveSessionsOptions,
  PromptInput,
  ResolveLatestSessionOptions,
  ResumeOptions,
  RunDaveProtocolAgentOptions,
  SendInputOptions,
  SendInputResult,
  SetLocaleResult,
  SteerTurnOptions,
  SubmitPromptOptions,
  UserPromptInput,
  DaveApp,
  DaveAppOptions,
  DaveModelOption,
} from "./app/types.js";
export * from "./auth-login.js";
export {
  inspectDaveCustomCommand,
  listDaveCustomCommands,
  loadDaveCustomCommand,
} from "./custom-commands.js";
export type {
  InspectDaveCustomCommandOptions,
  ListDaveCustomCommandsOptions,
  DaveCustomCommandInspection,
} from "./custom-commands.js";
export { createModelAdapter } from "./model-factory.js";
export type { CreateModelAdapterOptions } from "./model-factory.js";
export { startProcessProviderRegistryRuntime } from "./app/process-provider-registry-runtime.js";
export type { ProcessProviderRegistryRuntimeOptions } from "./app/process-provider-registry-runtime.js";
export {
  addDavePluginMarketplace,
  getDavePluginsOverview,
  installDaveMarketplacePlugin,
  listDavePlugins,
  removeDavePluginMarketplace,
  resolveDavePlugins,
  setDavePluginEnabled,
  uninstallDaveMarketplacePlugin,
  updateDaveMarketplacePlugin,
  updateDavePluginMarketplace,
  validateDavePluginPath,
} from "./plugins.js";
export type {
  AddDaveMarketplaceOptions,
  InstallDaveMarketplacePluginOptions,
  ListDavePluginsOptions,
  RemoveDaveMarketplaceOptions,
  ResolveDavePluginsOptions,
  SetDavePluginEnabledOptions,
  SetDavePluginEnabledResult,
  UninstallDaveMarketplacePluginOptions,
  UpdateDaveMarketplaceOptions,
  UpdateDaveMarketplacePluginOptions,
  ValidateDavePluginPathOptions,
  DaveAvailablePluginData,
  DaveInstalledPluginData,
  DaveMarketplaceSummaryData,
  DaveMarketplaceUpdateData,
  DavePluginInstallData,
  DavePluginUpdateData,
  DavePluginsOverviewData,
} from "./plugins.js";
export { runDaveProtocolAgent } from "./dave-protocol-entrypoint.js";
// Exposed for the CLI's --output-format stream-json: it needs the same event
// shape the protocol server emits, rather than inventing a second one.
export { mapSessionEvent } from "./dave-protocol/session-mapper.js";
export { prepareDaveTelemetryEnv, shutdownDaveTelemetry } from "./telemetry-bootstrap.js";
export type { SessionTranscriptMessage, SessionTranscriptPart } from "./session-transcript.js";
export { listDaveSessions, resolveLatestSession } from "./sessions.js";
export { inspectDaveSkill, listDaveSkills } from "./skills.js";
export type {
  InspectDaveSkillOptions,
  ListDaveSkillsOptions,
  DaveSkillInspection,
} from "./skills.js";
// Exposed for the CLI's headless slash routing: it must decide "is this a real
// custom command?" with the *same* reserved-name gate the app facade's
// customCommandPromptResolver applies, or the two disagree and a reserved name
// reaches the model as literal prompt text. See prompt-command.ts.
export { isReservedDaveSlashCommandName } from "./slash-command-surface.js";
export {
  grantWorkspaceHookTrust,
  inspectWorkspaceHookTrust,
  revokeWorkspaceHookTrustCli,
} from "./workspace-hook-trust-cli.js";
export type {
  WorkspaceHookTrustCliItem,
  WorkspaceHookTrustCliStatus,
  WorkspaceHookTrustCliTarget,
} from "./workspace-hook-trust-cli.js";
