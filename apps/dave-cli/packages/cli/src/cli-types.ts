import type { TuiReadClipboardImage, TuiWriteClipboardText } from "@dave/tui";
import type { UiLocale } from "@dave/i18n";
import type { Logger } from "@dave/contracts";
import type {
  createManagedCdpBrowserRuntime,
  ManagedCdpBrowserRuntimeOptions,
} from "@dave/adapters/browser";
import type {
  createModelAdapter,
  createDaveApp,
  CreateModelAdapterOptions,
  configureCodingPlanApiKey,
  ConfigureCodingPlanApiKeyOptions,
  inspectDaveSkill,
  inspectWorkspaceHookTrust,
  grantWorkspaceHookTrust,
  revokeWorkspaceHookTrustCli,
  inspectDaveCustomCommand,
  InspectDaveCustomCommandOptions,
  InspectDaveSkillOptions,
  loginDaveCli,
  loginBigmodelCodingPlan,
  LoginBigmodelCodingPlanOptions,
  LoginDaveCliOptions,
  listDaveCustomCommands,
  ListDaveCustomCommandsOptions,
  loadDaveCustomCommand,
  listDaveSessions,
  listDaveSkills,
  ListDaveSessionsOptions,
  ListDaveSkillsOptions,
  logoutDaveCli,
  LogoutDaveCliOptions,
  resolveLatestSession,
  ResolveLatestSessionOptions,
  RunDaveProtocolAgentOptions,
  prepareDaveTelemetryEnv,
  startProcessProviderRegistryRuntime,
  shutdownDaveTelemetry,
  DaveAppOptions,
} from "@dave/bootstrap";
import type { CliEnv, DotenvLoadResult, LoadCliDotenvOptions } from "./env.js";
import type { PluginsCommandOverrides } from "./plugins-command.js";
import type { CliShutdownProcess } from "./shutdown.js";
import type { resolveWorkspaceGitBranch } from "./tui-workspace-git.js";

export type BootstrapModule = typeof import("@dave/bootstrap");

export interface RunDependencies extends PluginsCommandOverrides {
  protocolLifecycle?: RunDaveProtocolAgentOptions["lifecycle"];
  protocolInput?: NodeJS.ReadableStream;
  createManagedCdpBrowserRuntime?: (
    options?: ManagedCdpBrowserRuntimeOptions,
  ) => ReturnType<typeof createManagedCdpBrowserRuntime>;
  createModelAdapter?: (
    options?: CreateModelAdapterOptions,
  ) => ReturnType<typeof createModelAdapter>;
  createDaveApp?: (
    options?: DaveAppOptions,
  ) => Awaited<ReturnType<typeof createDaveApp>> | ReturnType<typeof createDaveApp>;
  /**
   * Session-event shaper for --output-format stream-json. Defaults to the
   * bootstrap module's, which is also what the protocol server uses; injectable
   * so a caller that supplies its own `createDaveApp` (tests, embedders) can
   * still stream, since the bootstrap module is not loaded on that path.
   */
  mapSessionEvent?: BootstrapModule["mapSessionEvent"];
  cwd?: () => string;
  env?: CliEnv;
  inspectSkill?: (options: InspectDaveSkillOptions) => ReturnType<typeof inspectDaveSkill>;
  inspectWorkspaceHookTrust?: typeof inspectWorkspaceHookTrust;
  grantWorkspaceHookTrust?: typeof grantWorkspaceHookTrust;
  revokeWorkspaceHookTrustCli?: typeof revokeWorkspaceHookTrustCli;
  inspectCustomCommand?: (
    options: InspectDaveCustomCommandOptions,
  ) => ReturnType<typeof inspectDaveCustomCommand>;
  loginDaveCli?: (options?: LoginDaveCliOptions) => ReturnType<typeof loginDaveCli>;
  loginBigmodelCodingPlan?: (
    options?: LoginBigmodelCodingPlanOptions,
  ) => ReturnType<typeof loginBigmodelCodingPlan>;
  configureCodingPlanApiKey?: (
    options: ConfigureCodingPlanApiKeyOptions,
  ) => ReturnType<typeof configureCodingPlanApiKey>;
  loadDotenv?: (options?: LoadCliDotenvOptions) => DotenvLoadResult;
  prepareDaveTelemetryEnv?: typeof prepareDaveTelemetryEnv;
  projectConfigPath?: string;
  listSessions?: (options: ListDaveSessionsOptions) => ReturnType<typeof listDaveSessions>;
  listCustomCommands?: (
    options: ListDaveCustomCommandsOptions,
  ) => ReturnType<typeof listDaveCustomCommands>;
  loadCustomCommand?: (
    options: InspectDaveCustomCommandOptions,
  ) => ReturnType<typeof loadDaveCustomCommand>;
  // headless slash 路由要和 app facade 的保留名 gate 用同一个判据；默认取 bootstrap 的，
  // 注入点只为让单测不必拉起整个 bootstrap 模块。见 prompt-command.ts。
  isReservedSlashCommandName?: BootstrapModule["isReservedDaveSlashCommandName"];
  listSkills?: (options: ListDaveSkillsOptions) => ReturnType<typeof listDaveSkills>;
  logger?: Logger;
  readClipboardImage?: TuiReadClipboardImage;
  writeClipboardText?: TuiWriteClipboardText;
  resolveLatestSession?: (
    options: ResolveLatestSessionOptions,
  ) => ReturnType<typeof resolveLatestSession>;
  resolveWorkspaceGitBranch?: typeof resolveWorkspaceGitBranch;
  logoutDaveCli?: (options?: LogoutDaveCliOptions) => ReturnType<typeof logoutDaveCli>;
  runDaveProtocolAgent?: (options?: RunDaveProtocolAgentOptions) => Promise<void>;
  runTui?: typeof import("@dave/tui").runTui;
  skipUserConfig?: boolean;
  userConfigPath?: string;
  exitProcess?: (code: number) => void;
  shutdownCleanupTimeoutMs?: number;
  shutdownProcess?: CliShutdownProcess;
  startProcessProviderRegistryRuntime?: typeof startProcessProviderRegistryRuntime;
  shutdownDaveTelemetry?: typeof shutdownDaveTelemetry;
}

export type CliPermissionMode = "build" | "plan" | "edit" | "yolo";
export type CliRuntimeMode = CliPermissionMode | "auto";

export interface CliModeState {
  current?: CliRuntimeMode;
  override?: CliPermissionMode;
}

export interface CliTargetRequest {
  objective: string;
  replaceExisting: boolean;
}

export type ModeCapableApp = Awaited<ReturnType<typeof createDaveApp>> & {
  getMode?: () => CliRuntimeMode;
  setLocale?: (locale: UiLocale) => Promise<{ locale: "en-US" | "zh-CN" }>;
  setMode?: (mode: CliRuntimeMode) => Promise<{ mode: CliRuntimeMode }>;
};

export interface CliResumeRequest {
  continueSession: boolean;
  resumeSessionId?: string;
}
