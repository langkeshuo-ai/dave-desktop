import { ServiceChannels } from "@dave/shared";
import type {
  TraceId,
  DaveAgentMcpServer,
  DaveDeliveryKind,
  DaveMessageWithParts,
  ModelSelection,
  DavePermissionRequestParams,
  DaveUserInputRequestParams,
  DaveUserInputResponse,
  DaveSessionInfo,
  DaveSessionImportHistory,
  DaveSessionEvent,
  DaveSessionMode,
  DaveSessionPersistence,
  DaveSessionStateSnapshot,
  DaveStateUpdatedNotification,
  DaveWorkspacePresentation,
} from "@dave/shared";
import { createServiceDescriptor } from "#src/descriptors.js";

export interface DaveSessionWorkspaceTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
}

export type DaveSessionReadWorkspacePresentationParams = DaveSessionWorkspaceTarget;

export interface DaveTaskTarget extends DaveSessionWorkspaceTarget {
  sessionId: string;
}

export interface DaveSessionCreateParams extends DaveSessionWorkspaceTarget {
  /** 仅导入事务使用的预分配 ID；普通新会话继续由 Agent 分配。 */
  sessionId?: string;
  sessionTraceId?: TraceId;
  parentSessionId?: string;
  mode?: DaveSessionMode;
  model?: ModelSelection;
  persistence?: DaveSessionPersistence;
  thoughtLevel?: string;
  mcpServers?: DaveAgentMcpServer[];
  importedHistory?: DaveSessionImportHistory;
}

export interface DaveSessionResumeParams extends DaveTaskTarget {
  model?: ModelSelection;
  thoughtLevel?: string;
  mcpServers?: DaveAgentMcpServer[];
  /**
   * 默认广播 resume 得到的历史快照，并让 shadow 订阅请求初始 snapshot。
   * 续聊发送前的 runtime 预恢复会关闭它，避免旧终态快照覆盖本地已开始的新输入运行态。
   */
  broadcastSnapshot?: boolean;
}

export interface DaveSessionListParams extends DaveSessionWorkspaceTarget {
  includeArchived?: boolean;
  limit?: number;
}

export interface DaveSessionReadParams extends DaveTaskTarget {
  deliveryKind?: DaveDeliveryKind;
  messageLimit?: number;
  afterSeq?: number;
}

export interface DaveSessionMessagesParams extends DaveTaskTarget {
  afterMessageId?: string;
  limit?: number;
}

export interface DaveSessionEventsParams extends DaveTaskTarget {
  afterSeq?: number;
  limit?: number;
}

export interface DaveSessionSetModelParams extends DaveTaskTarget {
  model: ModelSelection;
  expectedRevision?: number;
  persistAsWorkspaceLastUsed?: boolean;
}

export interface DaveSessionSetThoughtLevelParams extends DaveTaskTarget {
  thoughtLevel?: string;
  expectedRevision?: number;
  persistAsWorkspaceLastUsed?: boolean;
}

export interface DaveSessionSetModeParams extends DaveTaskTarget {
  mode: DaveSessionMode;
  expectedRevision?: number;
}

export interface DaveSessionSubscribeParams extends DaveTaskTarget {
  deliveryKind: DaveDeliveryKind;
  afterSeq?: number;
  includeSnapshot?: boolean;
  eventCoalescing?: {
    mode: "background-summary";
    intervalMs?: number;
  };
}

export type DaveSessionServiceEvent =
  | { type: "session.event"; event: DaveSessionEvent }
  | { type: "state.updated"; notification: DaveStateUpdatedNotification }
  | { type: "permission.request"; request: DavePermissionRequestParams }
  | { type: "userInput.request"; request: DaveUserInputRequestParams }
  | {
      type: "userInput.response";
      requestId: string;
      response: DaveUserInputResponse;
    }
  | { type: "snapshot"; snapshot: DaveSessionStateSnapshot };

export interface DaveSessionInitializeResult {
  available: boolean;
  workspaceKey: string;
  protocolName?: string;
  protocolVersion?: number;
  transportKind?: "stdio" | "websocket";
  reason?: string;
  reasonCode?: "provider_not_ready";
}

export interface DaveSessionWorkspaceRuntimeIdentity {
  generation: number;
  identity: string;
  processId?: number;
  workspaceKey: string;
}

export interface IDaveSessionService {
  initializeWorkspace(params: DaveSessionWorkspaceTarget): Promise<DaveSessionInitializeResult>;
  getWorkspaceRuntimeIdentity(
    params: DaveSessionWorkspaceTarget,
  ): Promise<DaveSessionWorkspaceRuntimeIdentity>;
  readWorkspacePresentation(
    params: DaveSessionReadWorkspacePresentationParams,
  ): Promise<DaveWorkspacePresentation>;
  createSession(params: DaveSessionCreateParams): Promise<DaveSessionStateSnapshot>;
  resumeSession(params: DaveSessionResumeParams): Promise<DaveSessionStateSnapshot>;
  listSessions(params: DaveSessionListParams): Promise<DaveSessionInfo[]>;
  readSession(params: DaveSessionReadParams): Promise<DaveSessionStateSnapshot>;
  readSessionMessages(params: DaveSessionMessagesParams): Promise<DaveMessageWithParts[]>;
  readSessionEvents(params: DaveSessionEventsParams): Promise<DaveSessionEvent[]>;
  promoteDeferredDraftSession(params: DaveTaskTarget): Promise<void>;
  closeSession(params: DaveTaskTarget): Promise<void>;
  closeDeferredDraftSession(params: DaveTaskTarget): Promise<boolean>;
  setModel(params: DaveSessionSetModelParams): Promise<DaveSessionStateSnapshot>;
  setThoughtLevel(params: DaveSessionSetThoughtLevelParams): Promise<DaveSessionStateSnapshot>;
  setMode(params: DaveSessionSetModeParams): Promise<DaveSessionStateSnapshot>;
  // renderer 订阅面走 agentService 的 conversation/sessions-index 帧通道。
}

export const IDaveSessionService = createServiceDescriptor<IDaveSessionService>(
  ServiceChannels.DaveSession,
);
