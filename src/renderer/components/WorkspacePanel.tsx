import { useEffect, useState, useCallback } from "react"
import {
  FolderTree,
  RefreshCw,
  File as FileIcon,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Search,
  X,
} from "lucide-react"
import type { FileTreeNode } from "../../shared/workspace"
import { useMounted } from "../lib/useMounted"

interface WorkspacePanelProps {
  workspace: string
  onPickPath?: (relativePath: string) => void
}

// Cursor explorer — click file to @-mention into composer.
export function WorkspacePanel({ workspace, onPickPath }: WorkspacePanelProps) {
  const [tree, setTree] = useState<FileTreeNode[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState("")
  // mounted 守卫:fileTree 等待期间用户可能切走面板(workspaceOpen 翻成 false)。
  // 抽到 useMounted hook,Settings / WorkspacePanel 共享。
  const safeSet = useMounted()

  const refresh = useCallback(async () => {
    if (!workspace) return
    safeSet(() => {
      setLoading(true)
      setErr(null)
    })
    try {
      const nodes = await window.dave.workspace.fileTree({ depth: 4 })
      safeSet(() => {
        setTree(nodes)
        setExpanded(new Set(nodes.filter((n) => n.isDir).map((n) => n.path)))
      })
    } catch (e: unknown) {
      safeSet(() => setErr(e instanceof Error ? e.message : String(e)))
    } finally {
      safeSet(() => setLoading(false))
    }
  }, [workspace, safeSet])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** 递归过滤:如果名称匹配 filter 或任一子节点匹配,则保留。 */
  function filterNode(node: FileTreeNode, q: string): FileTreeNode | null {
    const nameMatch = node.name.toLowerCase().includes(q)
    if (!node.isDir) return nameMatch ? node : null
    const filteredChildren = node.children
      ?.map((c) => filterNode(c, q))
      .filter((c): c is FileTreeNode => c !== null)
    if (nameMatch || (filteredChildren && filteredChildren.length > 0)) {
      return { ...node, children: filteredChildren ?? [] }
    }
    return null
  }

  const displayedTree = filter.trim()
    ? tree
        .map((n) => filterNode(n, filter.trim().toLowerCase()))
        .filter((n): n is FileTreeNode => n !== null)
    : tree

  if (!workspace) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="empty-state !p-3">
          <div className="empty-state-icon !w-9 !h-9">
            <FolderTree size={16} />
          </div>
          <p className="empty-state-title !text-xs">未设置工作区</p>
          <p className="empty-state-desc !mb-0 !text-[11px]">设置 → 工作区</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="panel-header">
        <span className="flex items-center gap-1.5">
          <FolderTree size={12} />
          资源管理器
        </span>
        <button
          onClick={() => void refresh()}
          className="btn-icon-muted !p-1"
          title="刷新"
          aria-label="刷新"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {/* 搜索输入 */}
        <div className="px-2 pb-1">
          <div className="relative flex items-center">
            <Search
              size={11}
              className="absolute left-2 text-[var(--text-faint)] pointer-events-none"
            />
            <input
              type="search"
              className="input !py-1 !pl-6 !pr-6 !text-xs w-full"
              placeholder="过滤文件…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="过滤文件"
            />
            {filter && (
              <button
                type="button"
                className="absolute right-1 btn-icon-muted !p-0.5"
                onClick={() => setFilter("")}
                aria-label="清除过滤"
              >
                <X size={11} />
              </button>
            )}
          </div>
        </div>
        {/* 状态区域: aria-live=polite 让屏幕阅读器在状态变化时播报 */}
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {loading ? "工作区加载中" : err ? `错误:${err}` : "工作区就绪"}
        </div>
        {err && (
          <div
            role="alert"
            className="mx-2 my-1 p-2 bg-[var(--diff-del-bg)] border border-[var(--diff-del)] rounded text-xs text-[var(--diff-del)]"
          >
            {err}
          </div>
        )}
        {tree.length === 0 && !err && !loading && (
          <p className="px-3 py-2 text-xs text-[var(--text-faint)]">空工作区</p>
        )}
        {displayedTree.length === 0 && !err && !loading && filter.trim() && (
          <p className="px-3 py-2 text-xs text-[var(--text-faint)]">无匹配文件</p>
        )}
        {displayedTree.map((node) => (
          <TreeRow
            key={node.path}
            node={node}
            depth={0}
            expanded={expanded}
            setExpanded={setExpanded}
            onPickPath={onPickPath}
          />
        ))}
      </div>

      <div
        className="px-3 py-1.5 border-t border-[var(--border)] text-[10px] text-[var(--text-faint)] truncate"
        title={workspace}
      >
        {workspace}
      </div>
    </div>
  )
}

function relFromNode(path: string): string {
  // fileTree paths are already workspace-relative in agent implementation
  return path.replace(/\\/g, "/")
}

function TreeRow({
  node,
  depth,
  expanded,
  setExpanded,
  onPickPath,
}: {
  node: FileTreeNode
  depth: number
  expanded: Set<string>
  setExpanded: (s: Set<string>) => void
  onPickPath?: (relativePath: string) => void
}) {
  const isOpen = expanded.has(node.path)
  const toggle = () => {
    if (!node.isDir) {
      onPickPath?.(relFromNode(node.path))
      return
    }
    const next = new Set(expanded)
    if (isOpen) next.delete(node.path)
    else next.add(node.path)
    setExpanded(next)
  }

  return (
    <>
      <div
        className="file-tree-row"
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
        onClick={toggle}
        onDoubleClick={() => {
          if (!node.isDir) onPickPath?.(relFromNode(node.path))
        }}
        title={node.isDir ? "展开/折叠" : "点击插入 @path"}
        role={node.isDir ? "treeitem" : "button"}
        aria-expanded={node.isDir ? isOpen : undefined}
      >
        {node.isDir ? (
          <>
            {isOpen ? (
              <ChevronDown size={11} className="file-tree-icon" />
            ) : (
              <ChevronRight size={11} className="file-tree-icon" />
            )}
            {isOpen ? (
              <FolderOpen size={13} className="file-tree-icon" />
            ) : (
              <Folder size={13} className="file-tree-icon" />
            )}
          </>
        ) : (
          <>
            <span style={{ width: 11, display: "inline-block" }} />
            <FileIcon size={13} className="file-tree-icon" />
          </>
        )}
        <span className="file-tree-name">{node.name}</span>
        {node.size !== undefined && (
          <span className="text-[10px] text-[var(--text-faint)] ml-auto pl-2">
            {formatSize(node.size)}
          </span>
        )}
      </div>
      {node.isDir && isOpen && node.children && node.children.length > 0 && (
        <>
          {node.children.map((c) => (
            <TreeRow
              key={c.path}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              setExpanded={setExpanded}
              onPickPath={onPickPath}
            />
          ))}
        </>
      )}
    </>
  )
}

function formatSize(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)}GB`
}
