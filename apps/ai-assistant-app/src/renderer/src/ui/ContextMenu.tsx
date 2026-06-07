import { Paper, MenuList, MenuItem, ListSubheader } from '@mui/material'

export type MenuItemDef = { label: string; icon?: string; onClick: () => void }
// A category label row (non-clickable) used to group the items beneath it.
export type MenuHeaderDef = { header: string }
export type MenuEntry = MenuItemDef | MenuHeaderDef

function isHeader(e: MenuEntry): e is MenuHeaderDef {
  return 'header' in e
}

// ContextMenu — proste menu kontekstowe pozycjonowane przy kursorze. Pozycje typu
// MenuHeaderDef renderują się jako nieklikalne etykiety kategorii (grupowanie).
export default function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: MenuEntry[]
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
        {items.map((it, i) =>
          isHeader(it) ? (
            <ListSubheader
              key={`h-${i}`}
              disableSticky
              sx={{
                bgcolor: 'transparent',
                color: '#8b949e',
                lineHeight: '24px',
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: 0.5
              }}
            >
              {it.header}
            </ListSubheader>
          ) : (
            <MenuItem
              key={`i-${i}`}
              onClick={() => {
                it.onClick()
                onClose()
              }}
            >
              {it.icon !== undefined && (
                <span
                  aria-hidden
                  style={{ display: 'inline-block', width: 22, marginRight: 8, textAlign: 'center', flex: '0 0 auto' }}
                >
                  {it.icon}
                </span>
              )}
              {it.label}
            </MenuItem>
          )
        )}
      </MenuList>
    </Paper>
  )
}
