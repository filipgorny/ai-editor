import { useEffect, useState } from 'react'
import { Handle, Position } from 'reactflow'
import { useTranslation } from 'react-i18next'
import { Tooltip, CircularProgress } from '@mui/material'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import styled, { css, keyframes } from 'styled-components'
import { Controller, Node } from '@/model'
import { colors, kindColor, frameworkColor } from '@/styles/tokens'
import { techOf } from '@/styles/tech'
import { useEditor } from '@/common/editor/EditorContext'
import { useRunApp } from '@/views/diagram/RunAppContext'
import { useGit, useGitAuthor, reviewColor, type ReviewStatus } from '@/common/GitContext'
import { detectImplemented } from '@/views/diagram/GraphView'

// Kinds that represent real code entities (classes/functions) whose implementation
// status we surface on the card (implemented vs auto-created empty stub).
const CODE_KINDS = new Set(['class', 'function', 'service', 'controller', 'component', 'module'])

// Breathing yellow glow for the selected node.
const breathe = keyframes`
  0%, 100% { box-shadow: 0 0 10px rgba(242, 204, 96, 0.4); }
  50% { box-shadow: 0 0 24px rgba(242, 204, 96, 0.85); }
`

const Card = styled.div<{ $color: string; $selected?: boolean }>`
  position: relative;
  min-width: 210px;
  max-width: 280px;
  background: ${colors.panel};
  border: 1px solid ${(p) => (p.$selected ? '#ffffff' : p.$color)};
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);

  ${(p) =>
    p.$selected &&
    css`
      animation: ${breathe} 1.9s ease-in-out infinite;
    `}
`

const Header = styled.div`
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.04);
`

// Badge + RunPill share this exact height so the Run button matches the kind label.
const PILL_HEIGHT = '18px'

const Badge = styled.span<{ $color: string }>`
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  height: ${PILL_HEIGHT};
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  color: ${colors.bg};
  background: ${(p) => p.$color};
`

const RouteLabel = styled.span`
  margin-left: 8px;
  font-size: 12px;
  color: ${colors.muted};
`

const Name = styled.div<{ $selected?: boolean }>`
  margin-top: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
  font-size: 14px;
  color: ${(p) => (p.$selected ? '#ffffff' : 'inherit')};
  font-weight: ${(p) => (p.$selected ? 600 : 'inherit')};
`

// Autorstwo z gita (ostatnia zmiana) — drobny wiersz pod nazwą.
const Author = styled.div`
  margin-top: 4px;
  font-size: 11px;
  color: ${colors.muted};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

// Mała plakietka statusu review (new/modified) w nagłówku klocka.
const ReviewTag = styled.span<{ $color: string }>`
  margin-left: 8px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  color: ${colors.bg};
  background: ${(p) => p.$color};
`

// ImplTag — small pill showing whether a code entity already has real code (green)
// or is still an empty auto-created stub (muted), shown in the code-diagram view.
const ImplTag = styled.span<{ $done: boolean }>`
  margin-left: 8px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  color: ${colors.bg};
  background: ${(p) => (p.$done ? '#3fb950' : '#6e7681')};
`

const FnList = styled.div`
  padding: 8px 12px;
  max-height: 160px;
  overflow-y: auto;
  border-top: 1px solid ${colors.border};
`

const Fn = styled.div`
  font-family: monospace;
  font-size: 12px;
  color: ${colors.muted};
  padding: 1px 4px;
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    background: rgba(88, 166, 255, 0.18);
    color: #e6edf3;
  }
`

const Footer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 12px;
  border-top: 1px solid ${colors.border};
  font-size: 11px;
  color: ${colors.muted};
`

// RunCorner pins the Run button to the card's top-right corner so it never overlaps the
// language/framework footer or the title. top matches the Header's top padding so the pill
// lines up with the kind label on the same row.
const RunCorner = styled.div`
  position: absolute;
  top: 8px;
  right: 10px;
  z-index: 3;
`

// RunPill — the Run button styled to MATCH the kind label (Badge): identical height/box so it
// lines up with "package"/"app".
const RunPill = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  height: ${PILL_HEIGHT};
  padding: 0 7px;
  border-radius: 999px;
  border: 1px solid #f85149;
  background: rgba(13, 17, 23, 0.75);
  color: #f85149;
  cursor: pointer;

  &:hover {
    background: rgba(248, 81, 73, 0.16);
  }

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
`

// TechChip — a small badge: a coloured square icon + the language/framework name. Used to
// show BOTH the language and the framework of an app/package node in the footer.
const TechChip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  line-height: 1;
`

const TechIcon = styled.span<{ $color: string }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 15px;
  height: 13px;
  padding: 0 3px;
  border-radius: 3px;
  background: ${(p) => p.$color};
  color: #0d1117;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
`

// TechName — the language/framework text; line-height:1 so it sits centered against the icon.
const TechName = styled.span`
  line-height: 1;
`

// Tech renders one language/framework badge (coloured icon + name) from the tech catalog.
function Tech({ name }: { name: string }): React.JSX.Element {
  const v = techOf(name)

  return (
    <TechChip>
      <TechIcon $color={v?.color ?? colors.muted}>{v?.icon ?? '•'}</TechIcon>
      <TechName>{name}</TechName>
    </TechChip>
  )
}

// NodeCard renderuje domenowy Node jako klocek grafu.
export default function NodeCard({ data, selected }: { data: Node; selected?: boolean }) {
  const { t } = useTranslation()
  const openFile = useEditor()
  const { runningId, run } = useRunApp()
  const { review, statusByAbs } = useGit()
  // The Run button shows on the graph element that IS the React app (the app node).
  const isReactApp = data.kind === 'app' && data.framework === 'react'
  const isRunning = runningId === data.id
  // App/package container nodes always show the tech footer (language left, framework right),
  // so the language the scanner reported is visible at a glance.
  const isAppLike = data.kind === 'app' || data.kind === 'package'
  // Footer shows language (bottom-left) and framework (bottom-right). Shown for app/package
  // nodes (with a placeholder when the scanner gave no language) or whenever either is known.
  const showTech = isAppLike || !!data.language || !!data.framework
  const author = useGitAuthor(data.absFile)
  // App nodes are tinted by their framework (Go/React/Nest/Protobuf) so the kind of
  // service is recognizable at a glance; everything else uses its per-kind colour.
  const kColor =
    (data.kind === 'app' ? frameworkColor[data.framework] : undefined) ?? kindColor[data.kind] ?? colors.muted
  const route = data instanceof Controller ? data.route.toString() : ''

  // W trybie review ramka węzła oddaje status pliku (nowy = zielony, zmieniony = pomarańczowy).
  const status = review && data.absFile ? (statusByAbs[data.absFile] as ReviewStatus | undefined) : undefined
  const color = status ? reviewColor[status] : kColor

  // Resolve whether this code entity already has real code (vs empty stub). Lazy: read
  // the file once per node; undefined while resolving (no badge shown yet).
  const isCodeKind = CODE_KINDS.has(data.kind) && !!data.absFile
  const [implemented, setImplemented] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    if (!isCodeKind) {
      return
    }

    let alive = true

    detectImplemented(data)
      .then((v) => {
        if (alive) {
          setImplemented(v)
        }
      })
      .catch(() => undefined)

    return () => {
      alive = false
    }
  }, [isCodeKind, data])

  return (
    <Card $color={color} $selected={selected}>
      <Handle type="target" position={Position.Left} style={{ background: color }} />

      {isReactApp ? (
        <RunCorner>
          <Tooltip title={t('graph.runApp')}>
            <RunPill
              type="button"
              disabled={isRunning}
              onClick={(e) => {
                e.stopPropagation()
                run(data)
              }}
            >
              {isRunning ? (
                <CircularProgress size={11} sx={{ color: '#f85149' }} />
              ) : (
                <PlayArrowIcon sx={{ fontSize: 13 }} />
              )}
            </RunPill>
          </Tooltip>
        </RunCorner>
      ) : null}

      <Header>
        <Badge $color={kColor}>{data.kind}</Badge>
        {route ? <RouteLabel>{route}</RouteLabel> : null}
        {status ? <ReviewTag $color={reviewColor[status]}>{t('review.status.' + status)}</ReviewTag> : null}
        {isCodeKind && implemented !== undefined ? (
          <ImplTag $done={implemented} title={t(implemented ? 'graph.implemented' : 'graph.stub')}>
            {t(implemented ? 'graph.implemented' : 'graph.stub')}
          </ImplTag>
        ) : null}
        <Name $selected={selected}>
          {data.kind === 'folder' ? '📁 ' : ''}
          {data.name}
        </Name>
        {author ? <Author title={author}>✎ {author}</Author> : null}
      </Header>

      {data.hasFunctions() ? (
        <FnList>
          {data.functions.map((fn) => (
            <Fn
              key={fn.name}
              title={t('graph.openInEditor')}
              onClick={(e) => {
                e.stopPropagation()

                if (data.absFile) {
                  openFile(data.absFile, fn.name)
                }
              }}
            >
              · {fn.signature()}
            </Fn>
          ))}
        </FnList>
      ) : null}

      {showTech ? (
        <Footer>
          {/* Language icon + label, bottom-LEFT (info comes from the scanner). */}
          {data.language ? <Tech name={data.language} /> : <TechName>{t('graph.langUnknown')}</TechName>}

          {/* Framework icon + label, bottom-RIGHT. */}
          {data.framework ? <Tech name={data.framework} /> : <span />}
        </Footer>
      ) : null}

      <Handle type="source" position={Position.Right} style={{ background: color }} />
    </Card>
  )
}
