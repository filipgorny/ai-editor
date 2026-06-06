import { useEffect, useState } from 'react'
import { Handle, Position } from 'reactflow'
import { useTranslation } from 'react-i18next'
import styled, { css, keyframes } from 'styled-components'
import { Controller, Node } from '../model'
import { colors, kindColor } from '../styles/tokens'
import { useEditor } from './EditorContext'
import { useGit, useGitAuthor, reviewColor, type ReviewStatus } from './GitContext'
import { detectImplemented } from './GraphView'

// Kinds that represent real code entities (classes/functions) whose implementation
// status we surface on the card (implemented vs auto-created empty stub).
const CODE_KINDS = new Set(['class', 'function', 'service', 'controller', 'component', 'module'])

// Breathing yellow glow for the selected node.
const breathe = keyframes`
  0%, 100% { box-shadow: 0 0 10px rgba(242, 204, 96, 0.4); }
  50% { box-shadow: 0 0 24px rgba(242, 204, 96, 0.85); }
`

const Card = styled.div<{ $color: string; $selected?: boolean }>`
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

const Badge = styled.span<{ $color: string }>`
  display: inline-block;
  padding: 1px 8px;
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
  margin-top: 6px;
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
  gap: 6px;
  padding: 4px 12px;
  border-top: 1px solid ${colors.border};
  font-size: 11px;
  color: ${colors.muted};
`

const frameworkIcon: Record<string, string> = {
  nestjs: '🪺',
  react: '⚛️'
}

// NodeCard renderuje domenowy Node jako klocek grafu.
export default function NodeCard({ data, selected }: { data: Node; selected?: boolean }) {
  const { t } = useTranslation()
  const openFile = useEditor()
  const { review, statusByAbs } = useGit()
  const author = useGitAuthor(data.absFile)
  const kColor = kindColor[data.kind] ?? colors.muted
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

      {data.framework ? (
        <Footer>
          <span>{frameworkIcon[data.framework] ?? '🔧'}</span>
          <span>{data.framework}</span>
        </Footer>
      ) : null}

      <Handle type="source" position={Position.Right} style={{ background: color }} />
    </Card>
  )
}
