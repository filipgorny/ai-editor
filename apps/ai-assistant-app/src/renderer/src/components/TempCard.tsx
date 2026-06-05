import { Handle, Position } from 'reactflow'
import styled from 'styled-components'
import { kindColor } from '../styles/tokens'

const Box = styled.div<{ $color: string }>`
  min-width: 180px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #161b22;
  border: 1px dashed ${(p) => p.$color};
  color: #e6edf3;
  font-family: monospace;
  font-size: 13px;
  opacity: 0.9;
`

const Tag = styled.span<{ $color: string }>`
  color: ${(p) => p.$color};
  font-size: 11px;
  margin-right: 6px;
`

// TempCard — optymistyczny węzeł świeżo dodanego elementu (zanim re-skan przyniesie prawdziwy).
export default function TempCard({ data }: { data: { name: string; kind: string } }) {
  const color = kindColor[data.kind] ?? '#ffa657'

  return (
    <Box $color={color}>
      <Handle type="target" position={Position.Left} style={{ background: color }} />
      <Tag $color={color}>{data.kind === 'function' ? 'λ' : data.kind === 'folder' ? '📁' : '🟥'}</Tag>
      {data.name}
      <Handle type="source" position={Position.Right} style={{ background: color }} />
    </Box>
  )
}
