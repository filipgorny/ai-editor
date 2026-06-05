import { useTranslation } from 'react-i18next'
import ContextMenu from './ContextMenu'
import type { Node } from '../model'

type Kind = 'class' | 'function' | 'folder'

// NodeContextMenu — right-click menu for a graph node. Folders/apps can add
// elements (Class/Function/Folder, with icons); other nodes offer Edit/Rename/Delete.
export default function NodeContextMenu({
  x,
  y,
  node,
  addTargetDir,
  onAdd,
  onRename,
  onDelete,
  onEdit,
  onClose
}: {
  x: number
  y: number
  node: Node
  addTargetDir: (n: Node) => string | undefined
  onAdd: (dir: string | undefined, kind: Kind) => void
  onRename: (n: Node) => void
  onDelete: (n: Node) => void
  onEdit: (n: Node) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const isContainer = node.kind === 'folder' || node.kind === 'app'

  const items = isContainer
    ? [
        { label: `🟥  ${t('graph.class')}`, onClick: () => onAdd(addTargetDir(node), 'class') },
        { label: `λ  ${t('graph.function')}`, onClick: () => onAdd(addTargetDir(node), 'function') },
        { label: `📁  ${t('graph.folder')}`, onClick: () => onAdd(addTargetDir(node), 'folder') },
        { label: `✏️  ${t('graph.rename')}`, onClick: () => onRename(node) },
        { label: `🗑️  ${t('graph.deleteElement')}`, onClick: () => onDelete(node) }
      ]
    : [
        ...(node.absFile ? [{ label: `📝  ${t('graph.edit')}`, onClick: () => onEdit(node) }] : []),
        { label: `✏️  ${t('graph.rename')}`, onClick: () => onRename(node) },
        { label: `🗑️  ${t('graph.deleteElement')}`, onClick: () => onDelete(node) }
      ]

  return <ContextMenu x={x} y={y} onClose={onClose} items={items} />
}
