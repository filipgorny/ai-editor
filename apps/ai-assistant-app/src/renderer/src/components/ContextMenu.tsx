import { Paper, MenuList, MenuItem } from '@mui/material'

export type MenuItemDef = { label: string; onClick: () => void }

// ContextMenu — proste menu kontekstowe pozycjonowane przy kursorze.
export default function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: MenuItemDef[]
  onClose: () => void
}) {
  return (
    <Paper
      onContextMenu={(e) => e.preventDefault()}
      sx={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 30,
        minWidth: 180,
        bgcolor: '#161b22',
        border: '1px solid #30363d'
      }}
    >
      <MenuList dense>
        {items.map((it) => (
          <MenuItem
            key={it.label}
            onClick={() => {
              it.onClick()
              onClose()
            }}
          >
            {it.label}
          </MenuItem>
        ))}
      </MenuList>
    </Paper>
  )
}
