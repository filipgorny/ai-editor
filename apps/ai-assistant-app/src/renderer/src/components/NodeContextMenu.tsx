import { useTranslation } from 'react-i18next'
import ContextMenu, { type MenuEntry } from './ContextMenu'
import type { Node } from '../model'

type Kind = 'class' | 'function' | 'folder'

// NodeContextMenu — right-click menu for a graph node. Folders/apps can add
// elements (Class/Function/Folder, with icons). Class/function nodes (the code
// diagram) offer: open for editing, edit the method list, write an AI-helping
// description, and "Generate code" (enabled only when the node is not yet
// implemented — the scanner/heuristic decides via the `implemented` flag).
export default function NodeContextMenu({
  x,
  y,
  node,
  implemented,
  hasDescription,
  addTargetDir,
  onAdd,
  onRename,
  onDelete,
  onEdit,
  onEditMethods,
  onDescribe,
  onGenerate,
  onClose
}: {
  x: number
  y: number
  node: Node
  // implemented: undefined = still resolving, true/false = scanner/heuristic verdict.
  implemented?: boolean
  hasDescription?: boolean
  addTargetDir: (n: Node) => string | undefined
  onAdd: (dir: string | undefined, kind: Kind, parent: Node) => void
  onRename: (n: Node) => void
  onDelete: (n: Node) => void
  onEdit: (n: Node) => void
  onEditMethods: (n: Node) => void
  onDescribe: (n: Node) => void
  onGenerate: (n: Node) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const isContainer = node.kind === 'folder' || node.kind === 'app'
  // Only real code entities (classes/functions/etc. with a backing file) get the
  // method-list / describe / generate actions.
  const isCodeEntity = !isContainer && !!node.absFile

  if (isContainer) {
    const items: MenuEntry[] = [
      { header: t('graph.elementOptions') },
      { label: `✏️  ${t('graph.rename')}`, onClick: () => onRename(node) },
      { label: `🗑️  ${t('graph.deleteElement')}`, onClick: () => onDelete(node) },
      { header: t('graph.addElement') },
      { label: `🟥  ${t('graph.class')}`, onClick: () => onAdd(addTargetDir(node), 'class', node) },
      { label: `λ  ${t('graph.function')}`, onClick: () => onAdd(addTargetDir(node), 'function', node) },
      { label: `📁  ${t('graph.folder')}`, onClick: () => onAdd(addTargetDir(node), 'folder', node) }
    ]

    return <ContextMenu x={x} y={y} onClose={onClose} items={items} />
  }

  const items = [...(node.absFile ? [{ label: `📝  ${t('graph.edit')}`, onClick: () => onEdit(node) }] : [])]

  if (isCodeEntity) {
    items.push({ label: `📋  ${t('graph.editMethods')}`, onClick: () => onEditMethods(node) })
    items.push({
      label: `💬  ${hasDescription ? t('graph.editDescription') : t('graph.describe')}`,
      onClick: () => onDescribe(node)
    })

    // "Generate code" is disabled once the entity already has real code. We cannot
    // pass a disabled flag through ContextMenu, so when implemented we swap to a
    // no-op, greyed informational row instead.
    if (implemented) {
      items.push({ label: `✅  ${t('graph.alreadyImplemented')}`, onClick: () => undefined })
    } else {
      items.push({ label: `⚙️  ${t('graph.generateCode')}`, onClick: () => onGenerate(node) })
    }
  }

  items.push({ label: `✏️  ${t('graph.rename')}`, onClick: () => onRename(node) })
  items.push({ label: `🗑️  ${t('graph.deleteElement')}`, onClick: () => onDelete(node) })

  return <ContextMenu x={x} y={y} onClose={onClose} items={items} />
}
