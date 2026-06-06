import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Button } from '@mui/material'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import SettingsIcon from '@mui/icons-material/Settings'
import CodeIcon from '@mui/icons-material/Code'
import TerminalIcon from '@mui/icons-material/Terminal'
import { colors } from '../styles/tokens'
import { TopBarStats } from './TopBarStats'

const TopBarRoot = styled.header`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid ${colors.border};
  background: ${colors.panel};
`

// Slot where the integration phase mounts <TopBarStats/> (today's keystrokes / lines /
// finished tasks). It replaces the old 'ai-architect' project-name label.
const TopBarStatsSlot = styled.div`
  display: flex;
  align-items: center;
  min-width: 0;
`

type TopBarProps = {
  folder: string
  onPickProject: () => void
  onOpenSettings: () => void
  onOpenScripts: () => void
  onOpenLogs: () => void
}

export default function TopBar({ folder, onPickProject, onOpenSettings, onOpenScripts, onOpenLogs }: TopBarProps) {
  const { t } = useTranslation()

  return (
    <TopBarRoot>
      {/* TopBarStats: today's keystrokes / lines / finished tasks. Replaces the old
          'ai-architect' project-name label. */}
      <TopBarStatsSlot>
        <TopBarStats />
      </TopBarStatsSlot>
      <div style={{ flex: 1 }} />
      <Button variant={folder ? 'text' : 'contained'} size="small" startIcon={<FolderOpenIcon />} onClick={onPickProject}>
        {folder ? t('topbar.changeProject') : t('topbar.pickProject')}
      </Button>
      <Button size="small" startIcon={<SettingsIcon />} onClick={onOpenSettings}>
        {t('topbar.settings')}
      </Button>
      <Button size="small" startIcon={<CodeIcon />} onClick={onOpenScripts}>
        {t('topbar.scripts')}
      </Button>
      <Button size="small" startIcon={<TerminalIcon />} onClick={onOpenLogs}>
        {t('topbar.logs')}
      </Button>
    </TopBarRoot>
  )
}
