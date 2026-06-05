import { Handle, Position } from 'reactflow'
import styled from 'styled-components'
import { Controller, Node } from '../model'
import { colors, kindColor } from '../styles/tokens'
import { useEditor } from './EditorContext'

const Card = styled.div<{ $color: string }>`
  min-width: 210px;
  max-width: 280px;
  background: ${colors.panel};
  border: 1px solid ${(p) => p.$color};
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
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

const Name = styled.div`
  margin-top: 6px;
  font-family: monospace;
  font-size: 14px;
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
export default function NodeCard({ data }: { data: Node }) {
  const openFile = useEditor()
  const color = kindColor[data.kind] ?? colors.muted
  const route = data instanceof Controller ? data.route.toString() : ''

  return (
    <Card $color={color}>
      <Handle type="target" position={Position.Left} style={{ background: color }} />

      <Header>
        <Badge $color={color}>{data.kind}</Badge>
        {route ? <RouteLabel>{route}</RouteLabel> : null}
        <Name>
          {data.kind === 'folder' ? '📁 ' : ''}
          {data.name}
        </Name>
      </Header>

      {data.hasFunctions() ? (
        <FnList>
          {data.functions.map((fn) => (
            <Fn
              key={fn.name}
              title="Otwórz w edytorze"
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
