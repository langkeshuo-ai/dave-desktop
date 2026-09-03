/* Workspace shared types — kept in shared so main + renderer import the same shape. */
export interface FileTreeNode {
  path: string
  name: string
  isDir: boolean
  size?: number
  children?: FileTreeNode[]
}
