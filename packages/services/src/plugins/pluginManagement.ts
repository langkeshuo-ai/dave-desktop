// 平台能力面收敛：设置页「插件管理」的薄服务接口。
//
// 背景：pluginManagementStore / usePluginUninstall 过去直接注入 IDaveAgentService，
// UI 层因此散布 13 个 plugins/* 旧协议词的消费点。收敛为独立薄 service 后，UI 只依赖
// 本接口；plugins/* 词表的 host 侧消费点收拢到 pluginManagementService 一处（插件的
// 事实源在 dave-cli 进程，服务实现仍经 agent 协议往返——plugins 词表的收口归属
// 插件能力面自身的协议演进，不在会话 v4 词表范围内）。
// 注意与既有 IPluginsService（已 retired 的 marketplace pluginStore 通道）区分：
// 那套接口按 pluginName+marketplace 寻址且方法语义过时，不复用避免签名冲突。
import type { Event } from "@dave/rpc";
import type {
  DavePluginOperationProgressNotification,
  DavePluginsConfigureResult,
  DavePluginsCancelOperationResult,
  DavePluginsDescribeResult,
  DavePluginsInstallResult,
  DavePluginsListResult,
  DavePluginsMarketplaceMutationResult,
  DavePluginsOverviewResult,
  DavePluginsReferenceCatalogResult,
  DavePluginsRestoreBuiltinResult,
  DavePluginsSetEnabledResult,
  DavePluginsUninstallResult,
  DavePluginsValidateResult,
} from "@dave/shared";
import { ServiceChannels } from "@dave/shared";
import { createServiceDescriptor } from "../descriptors.js";
import type {
  DaveAgentAddPluginMarketplaceParams,
  DaveAgentConfigurePluginParams,
  DaveAgentCancelPluginOperationParams,
  DaveAgentDescribePluginParams,
  DaveAgentInstallPluginParams,
  DaveAgentPluginReferenceCatalogParams,
  DaveAgentResolveSuggestedPluginReferenceParams,
  DaveAgentResetPluginConfigParams,
  DaveAgentPluginViewParams,
  DaveAgentRemovePluginMarketplaceParams,
  DaveAgentRestoreBuiltinPluginParams,
  DaveAgentSetPluginEnabledParams,
  DaveAgentUninstallPluginParams,
  DaveAgentUpdatePluginMarketplaceParams,
  DaveAgentUpdatePluginParams,
  DaveAgentValidatePluginParams,
} from "../dave-agent/daveAgentPluginParams.js";

export interface IPluginManagementService {
  listPlugins(params: DaveAgentPluginViewParams): Promise<DavePluginsListResult>;
  /**
   * Plugin 对话引用 catalog：
   * 带 sessionId → session-owned 冻结 catalog；不带 → workspace 当前 catalog。
   * 实现路由到 workspace 级 agent client，不走插件管理独立进程。
   */
  getPluginReferenceCatalog(
    params: DaveAgentPluginReferenceCatalogParams,
  ): Promise<DavePluginsReferenceCatalogResult>;
  resolveSuggestedPluginReference(
    params: DaveAgentResolveSuggestedPluginReferenceParams,
  ): Promise<import("@dave/shared").DavePluginsResolveSuggestedReferenceResult>;
  onDynamicPluginOperationProgress(
    operationId: string,
  ): Event<DavePluginOperationProgressNotification>;
  getPluginsOverview(params: DaveAgentPluginViewParams): Promise<DavePluginsOverviewResult>;
  addPluginMarketplace(
    params: DaveAgentAddPluginMarketplaceParams,
  ): Promise<DavePluginsMarketplaceMutationResult>;
  removePluginMarketplace(
    params: DaveAgentRemovePluginMarketplaceParams,
  ): Promise<DavePluginsMarketplaceMutationResult>;
  updatePluginMarketplace(
    params: DaveAgentUpdatePluginMarketplaceParams,
  ): Promise<DavePluginsMarketplaceMutationResult>;
  installPlugin(params: DaveAgentInstallPluginParams): Promise<DavePluginsInstallResult>;
  cancelPluginOperation(
    params: DaveAgentCancelPluginOperationParams,
  ): Promise<DavePluginsCancelOperationResult>;
  uninstallPlugin(params: DaveAgentUninstallPluginParams): Promise<DavePluginsUninstallResult>;
  updatePlugin(params: DaveAgentUpdatePluginParams): Promise<DavePluginsInstallResult>;
  restoreBuiltinPlugin(
    params: DaveAgentRestoreBuiltinPluginParams,
  ): Promise<DavePluginsRestoreBuiltinResult>;
  configurePlugin(params: DaveAgentConfigurePluginParams): Promise<DavePluginsConfigureResult>;
  resetPluginConfig(
    params: DaveAgentResetPluginConfigParams,
  ): Promise<DavePluginsConfigureResult>;
  validatePlugin(params: DaveAgentValidatePluginParams): Promise<DavePluginsValidateResult>;
  describePlugin(params: DaveAgentDescribePluginParams): Promise<DavePluginsDescribeResult>;
  setPluginEnabled(params: DaveAgentSetPluginEnabledParams): Promise<DavePluginsSetEnabledResult>;
}

export const IPluginManagementService = createServiceDescriptor<IPluginManagementService>(
  ServiceChannels.PluginManagement,
);
