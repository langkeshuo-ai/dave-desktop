import type { WorkspacePurpose, DaveTaskMeta } from "@dave/shared";

export type DaveTaskListKind = "pinned" | "archived" | "timeline" | "active";
export type DaveTaskListSortBy = "created" | "updated";

export interface DaveTaskListWorkspaceScope {
  workspacePath: string;
  workspaceIdentity?: string;
  workspacePurpose?: WorkspacePurpose;
}

export interface DaveTaskListQuery {
  kind: DaveTaskListKind;
  workspaceScopes: DaveTaskListWorkspaceScope[];
  sortBy: DaveTaskListSortBy;
  search?: string;
  limit?: number;
}

export type DaveTaskListItem = DaveTaskMeta & {
  searchSnippet?: string;
  searchSnippets?: string[];
};

export interface DaveTaskListResult {
  items: DaveTaskListItem[];
  total: number;
  hasMore: boolean;
}

export type DaveTaskGroupColor =
  | "gray"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple";

export interface DaveTaskGroup {
  id: string;
  title: string;
  color: DaveTaskGroupColor;
  createdAt: number;
  updatedAt: number;
}

export interface DaveGroupedTaskRef {
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string;
}

export type DaveGroupedTaskViewTopLevelNodeRef =
  | { type: "group"; groupId: string }
  | { type: "task"; task: DaveGroupedTaskRef };

export type DaveGroupedTaskViewNode =
  | {
      type: "group";
      group: DaveTaskGroup;
      tasks: DaveTaskListItem[];
      sortOrder?: number;
    }
  | {
      type: "task";
      task: DaveTaskListItem;
      sortOrder?: number;
    };

export interface DaveGroupedTaskView {
  nodes: DaveGroupedTaskViewNode[];
}

export interface DaveGroupedTaskViewQuery {
  workspaceScopes: DaveTaskListWorkspaceScope[];
  includeAllWorkspaces?: boolean;
}

// ── grouped 原始结构（不 join tasks 表）──
// grouped 视图的任务数据源迁到 sessions-index 后，服务端只提供分组结构
// （task_groups / task_group_members / task_group_view_node_orders），
// 由客户端与 sessions-index 会话做 join。

/** 组成员引用（不含任务 meta；task 内容由 sessions-index 提供）。 */
export interface DaveGroupedTaskViewStructureMember {
  groupId: string;
  /** 服务端口径 workspaceKey（resolveWorkspaceKey：identity ?? path），join 匹配键。 */
  workspaceKey: string;
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string;
  /** null = 尚未落 sort_order（新加入组）；客户端按 addedAt 降序补内存序。 */
  sortOrder: number | null;
  addedAt: number;
}

/** 顶层节点排序（task_group_view_node_orders，node_key 已解析为结构化引用）。 */
export type DaveGroupedTaskViewStructureTopOrder =
  | { type: "group"; groupId: string; sortOrder: number }
  | { type: "task"; workspaceKey: string; taskId: string; sortOrder: number };

export interface DaveGroupedTaskViewStructure {
  /** 已按 workspaceScopes 可见性过滤的 group（bootstrap workspace group 只在其 workspace 可见）。 */
  groups: DaveTaskGroup[];
  /** 全量组成员（含不可见 group 的成员——顶层排除规则需要全量判断）。 */
  members: DaveGroupedTaskViewStructureMember[];
  topLevelOrders: DaveGroupedTaskViewStructureTopOrder[];
}

export interface DaveGroupedTaskViewOrderInput {
  workspaceScopes: DaveTaskListWorkspaceScope[];
  topLevelNodes: DaveGroupedTaskViewTopLevelNodeRef[];
  groups: Array<{
    groupId: string;
    taskRefs: DaveGroupedTaskRef[];
  }>;
}

export interface DaveWorkspaceEventSubscriptionParams {
  workspacePath: string;
  workspaceIdentity?: string;
}
