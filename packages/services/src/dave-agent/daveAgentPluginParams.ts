import type {
  DaveAgentMcpServer,
  DaveAutomationScheduleRule,
  DaveMcpListMode,
  ModelSelection,
} from "@dave/shared";

export interface DaveAgentWorkspaceTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  /** 远程 workspace 的运行时会话身份；只用于隔离/路由，不能替代 workspacePath。 */
  remoteSessionId?: string;
}

export interface DaveAgentPluginViewParams extends DaveAgentWorkspaceTarget {
  configScope?: "user" | "workspace";
}

export interface DaveAgentListMcpServerStatusesParams extends DaveAgentWorkspaceTarget {
  mcpServers?: DaveAgentMcpServer[];
  mode?: DaveMcpListMode;
}

export interface DaveAgentAddPluginMarketplaceParams extends DaveAgentWorkspaceTarget {
  dryRun?: boolean;
  operationId?: string;
  source: string;
}

export interface DaveAgentRemovePluginMarketplaceParams extends DaveAgentWorkspaceTarget {
  marketplace: string;
}

export interface DaveAgentUpdatePluginMarketplaceParams extends DaveAgentWorkspaceTarget {
  marketplace?: string;
  operationId?: string;
}

export interface DaveAgentInstallPluginParams extends DaveAgentWorkspaceTarget {
  dryRun?: boolean;
  marketplace: string;
  operationId?: string;
  pluginName: string;
  scope?: "user" | "workspace";
}

export interface DaveAgentCancelPluginOperationParams {
  operationId: string;
}

export interface DaveAgentUninstallPluginParams extends DaveAgentWorkspaceTarget {
  marketplace?: string;
  pluginId?: string;
  pluginName?: string;
  removeCache?: boolean;
}

export interface DaveAgentUpdatePluginParams extends DaveAgentWorkspaceTarget {
  pluginId?: string;
  marketplace?: string;
}

export interface DaveAgentRestoreBuiltinPluginParams extends DaveAgentWorkspaceTarget {
  pluginId: string;
}

export interface DaveAgentConfigurePluginParams extends DaveAgentWorkspaceTarget {
  clearOptionKeys?: string[];
  dryRun?: boolean;
  options: Record<string, unknown>;
  pluginId: string;
  scope?: "user" | "workspace";
}

export interface DaveAgentResetPluginConfigParams extends DaveAgentWorkspaceTarget {
  pluginId: string;
  scope?: "user" | "workspace";
}

export interface DaveAgentValidatePluginParams extends DaveAgentWorkspaceTarget {
  marketplace?: string;
  pluginName?: string;
  source?: string;
}

export interface DaveAgentDescribePluginParams extends DaveAgentWorkspaceTarget {
  marketplace: string;
  pluginName: string;
}

export interface DaveAgentSetPluginEnabledParams extends DaveAgentWorkspaceTarget {
  enabled: boolean;
  operationId?: string;
  pluginId: string;
  scope?: "user" | "workspace";
}

// Plugin 对话引用 catalog：
// 带 sessionId → session-owned 冻结 catalog（必须路由到持有该 session 的 workspace client）；
// 不带 → workspace 当前 catalog（新建草稿 Picker）。
export interface DaveAgentPluginReferenceCatalogParams extends DaveAgentWorkspaceTarget {
  sessionId?: string;
}

// Composer Skill catalog：与 Plugin 引用相同，以 sessionId 区分 workspace 当前目录和
// resident Session runtime 快照；不参与 Settings 管理目录。
export interface DaveAgentSkillReferenceCatalogParams extends DaveAgentWorkspaceTarget {
  sessionId?: string;
}
export interface DaveAgentResolveSuggestedPluginReferenceParams extends DaveAgentWorkspaceTarget {
  stableId: string;
  operationId: string;
  clientMode: "desktop-continuous" | "web-remote-replayable";
  deliveryKind: "desktop-continuous" | "web-remote-replayable";
}

// ---- 定时任务(automation)管理参数 ----

export interface DaveAgentCreateAutomationParams extends DaveAgentWorkspaceTarget {
  title: string;
  cronExpr: string;
  relativeDelayMinutes?: number;
  prompt: string;
  modelSelection?: ModelSelection;
  mode?: string;
  recurring?: boolean;
  maxRuns?: number;
  endAt?: number;
  scheduleRule?: DaveAutomationScheduleRule;
}

export interface DaveAgentUpdateAutomationParams extends DaveAgentWorkspaceTarget {
  automationId: string;
  title?: string;
  cronExpr?: string;
  prompt?: string;
  modelSelection?: ModelSelection | null;
  mode?: string | null;
  recurring?: boolean;
  maxRuns?: number | null;
  endAt?: number | null;
  scheduleRule?: DaveAutomationScheduleRule | null;
  scheduleEditedByUser?: boolean;
}

export interface DaveAgentAutomationIdParams extends DaveAgentWorkspaceTarget {
  automationId: string;
}

export interface DaveAgentSetAutomationEnabledParams extends DaveAgentWorkspaceTarget {
  automationId: string;
  enabled: boolean;
}

export interface DaveAgentDeleteAutomationRunParams extends DaveAgentWorkspaceTarget {
  runId: string;
}
