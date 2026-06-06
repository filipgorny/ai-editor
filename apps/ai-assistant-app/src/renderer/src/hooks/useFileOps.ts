import { useTranslation } from 'react-i18next'
import { Node } from '../model'
import { appBus } from '../events'

type FileOpsDeps = {
  folder: string
  openFile: (absFile: string, fn?: string, animate?: boolean, gotoLine?: number) => void
  refreshForPath: (p: string) => void
  setFocusPath: (p: string) => void
}

export function useFileOps(deps: FileOpsDeps) {
  const { folder, openFile, refreshForPath, setFocusPath } = deps
  const { t } = useTranslation()

  // „Dodaj element" — folder: utwórz katalog; klasa: utwórz plik w katalogu
  // docelowym (folderu z menu lub roota), AI wypełnia pustą klasę, otwórz + rescan.
  const addElement = async (name: string, file: string, kind: 'class' | 'function' | 'folder', targetDir?: string) => {
    const base = targetDir || folder

    if (!base) {
      return
    }

    if (kind === 'folder') {
      const dir = await window.api.createFolder(base, file)
      window.api.publishEvent({ type: 'create', title: t('events.createFolder'), file: dir })
      appBus.emit('folder:create', { path: dir })
      refreshForPath(dir) // deep-rescan the app that contains the new folder

      return
    }

    const path = await window.api.createFile(base, file, name)

    if (!path) {
      return
    }

    // AI wypełnia pustą klasę/funkcję o podanej nazwie.
    const what = kind === 'function' ? `pustą funkcję o nazwie ${name}` : `pustą klasę o nazwie ${name}`
    const generated = await window.api
      .aiEdit('', `Utwórz ${what}. Zwróć tylko kod, bez komentarzy.`, path)
      .catch(() => '')

    if (generated && generated.trim()) {
      await window.api.saveFile(path, generated)
    }

    openFile(path)
    window.api.publishEvent({ type: 'create', title: t('events.createElement'), file: path })
    appBus.emit('file:create', { path, kind })
    setFocusPath(path)
    refreshForPath(path) // deep-rescan the app so the new class appears on the graph
  }

  // „Zmień nazwę" — zmień nazwę klasy w kodzie i nazwę pliku, otwórz nowy plik.
  const renameElement = async (node: Node, className: string, fileBase: string) => {
    if (!node.absFile) {
      return
    }

    const path = await window.api.renameFile(node.absFile, fileBase, className, node.name)

    if (path) {
      openFile(path)
      window.api.publishEvent({ type: 'rename', title: t('events.rename'), file: path })
      appBus.emit('file:rename', { from: node.absFile, to: path })
      setFocusPath(path)
      refreshForPath(path)
    }
  }

  // „Przenieś plik" (przeciągnięcie linii do folderu) — przenieś na dysku + rescan.
  const moveFile = async (node: Node, targetDir: string) => {
    if (!node.absFile) {
      return
    }

    const path = await window.api.moveFile(node.absFile, targetDir)
    window.api.publishEvent({ type: 'move', title: t('events.move'), file: path })
    appBus.emit('file:move', { from: node.absFile, to: path })
    setFocusPath(path)
    refreshForPath(path)
  }

  // „Usuń element" — usuń plik/folder (przez gateway → filer) i odśwież graf.
  const deleteElement = async (node: Node, path: string) => {
    if (!window.confirm(t('graph.deleteConfirm', { name: node.name }))) {
      return
    }

    await window.api.deleteFile(path)
    window.api.publishEvent({ type: 'delete', title: t('events.delete'), file: path })
    appBus.emit('file:delete', { path })
    refreshForPath(path)
  }

  return { addElement, renameElement, moveFile, deleteElement }
}
