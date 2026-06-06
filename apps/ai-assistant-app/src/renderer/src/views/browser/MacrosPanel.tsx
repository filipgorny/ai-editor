// MacrosPanel — the dropdown that hangs off a page window's macros button.
//
// Lists the stored Lua macros, lets the user run one against the page (translated to
// webview actions by macroRunner), add a new macro, edit a macro's Lua body, and delete
// macros. It is a controlled popover: the parent window owns open/close and supplies the
// live <webview> so a run targets exactly that page.

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconButton, Tooltip } from '@mui/material'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import SaveIcon from '@mui/icons-material/Save'
import styled from 'styled-components'
import { colors } from '../../styles/tokens'
import type { Api } from './types'
import { listMacros, saveMacro, deleteMacro, type Macro } from './macroStore'
import { runMacro, type MacroLog, type MacroWebview } from './macroRunner'

const Panel = styled.div`
  position: absolute;
  top: 38px;
  right: 8px;
  z-index: 30;
  width: 360px;
  max-height: 420px;
  display: flex;
  flex-direction: column;
  background: ${colors.panel};
  border: 1px solid ${colors.border};
  border-radius: 8px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
  overflow: hidden;
`

const PanelHead = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid ${colors.border};
  color: #e6edf3;
  font-size: 13px;
  font-weight: 600;
`

const MacroList = styled.div`
  overflow-y: auto;
  max-height: 180px;
`

const MacroRow = styled.div<{ $sel: boolean }>`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  cursor: pointer;
  background: ${(p) => (p.$sel ? 'rgba(88,166,255,0.14)' : 'transparent')};
  color: #c9d1d9;
  font-size: 13px;

  &:hover {
    background: rgba(88, 166, 255, 0.1);
  }
`

const MacroName = styled.div`
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const Editor = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border-top: 1px solid ${colors.border};
`

const NameInput = styled.input`
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid ${colors.border};
  background: ${colors.bg};
  color: #e6edf3;
  font-size: 13px;
  outline: none;

  &:focus {
    border-color: ${colors.controller};
  }
`

const CodeArea = styled.textarea`
  min-height: 110px;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid ${colors.border};
  background: #000;
  color: #d6deeb;
  font-family: 'Hack', monospace;
  font-size: 12.5px;
  line-height: 1.45;
  resize: vertical;
  outline: none;

  &:focus {
    border-color: ${colors.controller};
  }
`

const LogBox = styled.div`
  max-height: 96px;
  overflow-y: auto;
  padding: 6px 10px;
  border-top: 1px solid ${colors.border};
  font-family: 'Hack', monospace;
  font-size: 11.5px;
`

const LogLine = styled.div<{ $err: boolean }>`
  color: ${(p) => (p.$err ? colors.danger : colors.muted)};
  white-space: pre-wrap;
`

const Spacer = styled.div`
  flex: 1;
`

export default function MacrosPanel({
  api,
  getWebview,
  onClose
}: {
  api: Api
  getWebview: () => MacroWebview | null
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [macros, setMacros] = useState<Macro[]>([])
  const [selId, setSelId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [logs, setLogs] = useState<MacroLog[]>([])
  const [running, setRunning] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true

    listMacros(api).then((list) => {
      if (alive) {
        setMacros(list)
      }
    })

    return () => {
      alive = false
    }
  }, [api])

  // Close when clicking outside the panel.
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('mousedown', onDown)

    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const select = (m: Macro): void => {
    setSelId(m.id)
    setName(m.name)
    setCode(m.content)
    setLogs([])
  }

  const startNew = (): void => {
    setSelId(null)
    setName(t('browser.newMacro'))
    setCode("type('#email', 'a@b.com')\ntype('#password', 'test')\nclick('#submit')")
    setLogs([])
  }

  const save = async (): Promise<void> => {
    const trimmed = name.trim()

    if (!trimmed) return

    const saved = await saveMacro(api, { id: selId ?? undefined, name: trimmed, content: code })

    setSelId(saved.id)
    setMacros(await listMacros(api))
  }

  const remove = async (m: Macro, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()

    await deleteMacro(api, m.id)

    if (selId === m.id) {
      setSelId(null)
      setName('')
      setCode('')
    }

    setMacros(await listMacros(api))
  }

  const run = async (): Promise<void> => {
    const view = getWebview()

    if (!view) {
      setLogs([{ level: 'error', text: t('browser.noPage') }])

      return
    }

    setRunning(true)
    setLogs([])

    try {
      await runMacro(code, view, (l) => setLogs((prev) => [...prev, l]))

      setLogs((prev) => [...prev, { level: 'info', text: t('browser.macroDone') }])
    } catch {
      // the error line was already pushed by the runner's onLog
    } finally {
      setRunning(false)
    }
  }

  return (
    <Panel ref={ref}>
      <PanelHead>
        {t('browser.macros')}

        <Spacer />

        <Tooltip title={t('browser.newMacro')}>
          <IconButton size="small" onClick={startNew} sx={{ color: '#8b949e' }}>
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </PanelHead>

      <MacroList>
        {macros.map((m) => (
          <MacroRow key={m.id} $sel={m.id === selId} onClick={() => select(m)}>
            <MacroName>{m.name}</MacroName>

            <Tooltip title={t('browser.runMacro')}>
              <IconButton
                size="small"
                disabled={running}
                onClick={(e) => {
                  e.stopPropagation()
                  select(m)
                  run()
                }}
                sx={{ color: colors.service }}
              >
                <PlayArrowIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title={t('fileTree.delete')}>
              <IconButton size="small" onClick={(e) => remove(m, e)} sx={{ color: colors.danger }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </MacroRow>
        ))}
      </MacroList>

      <Editor>
        <NameInput
          value={name}
          placeholder={t('browser.macroName')}
          onChange={(e) => setName(e.target.value)}
        />

        <CodeArea value={code} placeholder={t('browser.macroBodyHint')} onChange={(e) => setCode(e.target.value)} spellCheck={false} />

        <div style={{ display: 'flex', gap: 6 }}>
          <Tooltip title={t('browser.recordMacro')}>
            <span>
              <IconButton size="small" onClick={save} sx={{ color: colors.controller }}>
                <SaveIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          <Tooltip title={t('browser.runMacro')}>
            <span>
              <IconButton size="small" disabled={running} onClick={run} sx={{ color: colors.service }}>
                <PlayArrowIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </div>
      </Editor>

      {logs.length > 0 && (
        <LogBox>
          {logs.map((l, i) => (
            <LogLine key={i} $err={l.level === 'error'}>
              {l.text}
            </LogLine>
          ))}
        </LogBox>
      )}
    </Panel>
  )
}
