// TasksView — the tasks view (ViewKey 'tasks', plan item 4).
//
// A list of tasks scoped to the open project with a single "active" task selection.
// A side panel connects to Jira (config form + import) and an "auto-branch" toggle that,
// when a task is set active, creates/checks out a git branch for it via the git
// auto-branch IPC. Everything persists through the tasks/Jira window.api methods.
//
// Per the view contract this file imports ONLY ./types (ViewContext), the global
// window.api (via ctx.api) and the app bus (via ctx.bus). It does NOT import App, the
// registry or sibling views.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  TextField,
  Tooltip,
  Typography
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import CallSplitIcon from '@mui/icons-material/CallSplit'
import LinkIcon from '@mui/icons-material/Link'
import type { ViewContext } from '@/views/types'
import { colors } from '@/styles/tokens'
import { toast } from '@/toast'

// Local mirror of the persisted Task shape (global.d.ts owns the canonical `Task`).
type TaskRow = {
  id: number
  title: string
  description: string
  status: 'todo' | 'doing' | 'done'
  jiraKey?: string
  branch?: string
  active: boolean
  project: string
  createdAt: number
  updatedAt: number
}

type JiraForm = { baseUrl: string; email: string; token: string; project: string }

const EMPTY_JIRA: JiraForm = { baseUrl: '', email: '', token: '', project: '' }

const Root = styled.div`
  height: 100%;
  display: flex;
  overflow: hidden;
  background: ${colors.bg};
  color: #c9d1d9;
`

const Main = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  border-bottom: 1px solid ${colors.border};
  /* Solid panel background so the header reads clearly over the wallpaper. */
  background: ${colors.panel};
`

const HeaderTitle = styled(Typography)`
  flex: 1 1 auto;
  font-weight: 600;
`

const AddRow = styled.form`
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid ${colors.border};
  /* Solid panel background so the "Add task" form stands out over the wallpaper. */
  background: ${colors.panel};
`

const List = styled.div`
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 8px 0;
`

const Empty = styled.div`
  padding: 32px 16px;
  text-align: center;
  color: ${colors.muted};
`

const Row = styled.div<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-left: 3px solid ${(p) => (p.$active ? 'var(--accent, #58a6ff)' : 'transparent')};
  background: ${(p) => (p.$active ? 'rgba(88, 166, 255, 0.08)' : 'transparent')};
  cursor: pointer;

  &:hover {
    background: rgba(255, 255, 255, 0.03);
  }
`

const RowBody = styled.div`
  flex: 1 1 auto;
  min-width: 0;
`

const RowTitle = styled.div<{ $done: boolean }>`
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-decoration: ${(p) => (p.$done ? 'line-through' : 'none')};
  color: ${(p) => (p.$done ? colors.muted : '#e6edf3')};
`

const RowMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
`

// StatusChipWrap — keeps the right-aligned status chip off the trash icon.
const StatusChipWrap = styled.div`
  flex: 0 0 auto;
  margin-right: 8px;
`

const statusColor: Record<TaskRow['status'], string> = {
  todo: colors.muted,
  doing: colors.controller,
  done: colors.service
}

// makeBranchName — derive a safe git branch name from a task (jiraKey preferred).
function makeBranchName(task: TaskRow): string {
  const base = task.jiraKey?.trim() || `task-${task.id}`

  const slug = task.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

  const name = slug ? `${base}-${slug}` : base

  return name.replace(/^-+|-+$/g, '')
}

export default function TasksView({ ctx }: { ctx: ViewContext }): React.JSX.Element {
  const { t } = useTranslation()
  const { api, bus, folder } = ctx
  const project = folder || ''

  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [newTitle, setNewTitle] = useState('')
  const [autoBranch, setAutoBranch] = useState(true)
  const [jira, setJira] = useState<JiraForm>(EMPTY_JIRA)
  const [jiraBusy, setJiraBusy] = useState(false)
  const [jiraOpen, setJiraOpen] = useState(false)

  const reload = useCallback(async () => {
    try {
      const rows = (await api.tasksList(project)) as TaskRow[]

      setTasks(rows ?? [])
    } catch {
      setTasks([])
    }
  }, [api, project])

  // Load tasks + Jira config whenever the project changes or the scene resets.
  useEffect(() => {
    reload()
  }, [reload, ctx.navKey])

  useEffect(() => {
    let cancelled = false

    api
      .jiraGetConfig()
      .then((cfg) => {
        if (!cancelled && cfg) {
          setJira({ baseUrl: cfg.baseUrl, email: cfg.email, token: cfg.token, project: cfg.project })
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [api])

  const activeTask = useMemo(() => tasks.find((tk) => tk.active) ?? null, [tasks])

  // addTask — persist a new todo for the current project.
  const addTask = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()

      const title = newTitle.trim()

      if (!title) return

      try {
        await api.tasksSave({ title, project, status: 'todo' })
        setNewTitle('')
        await reload()
      } catch {
        toast.error(t('tasks.saveFailed'))
      }
    },
    [api, newTitle, project, reload, t]
  )

  // setActive — mark a task active and, if auto-branch is on, create/checkout its branch.
  const setActive = useCallback(
    async (task: TaskRow) => {
      try {
        const saved = (await api.tasksSetActive(task.id)) as TaskRow
        let branch = saved.branch || task.branch

        if (autoBranch && project) {
          const name = saved.branch || makeBranchName(saved)

          try {
            const res = await api.gitCreateBranch(project, name)

            branch = res.branch

            if (!saved.branch || saved.branch !== res.branch) {
              await api.tasksSave({ id: saved.id, title: saved.title, project, branch: res.branch })
            }

            toast.success(t('tasks.branchCreated', { branch: res.branch }))
          } catch {
            toast.error(t('tasks.branchFailed'))
          }
        }

        bus.emit('tasks:active-change' as never, {
          id: saved.id,
          title: saved.title,
          branch
        } as never)

        await reload()
      } catch {
        toast.error(t('tasks.saveFailed'))
      }
    },
    [api, autoBranch, project, bus, reload, t]
  )

  // cycleStatus — advance todo → doing → done → todo; bump stats.tasks when completed.
  const cycleStatus = useCallback(
    async (task: TaskRow) => {
      const order: TaskRow['status'][] = ['todo', 'doing', 'done']
      const next = order[(order.indexOf(task.status) + 1) % order.length]

      try {
        await api.tasksSave({ id: task.id, title: task.title, project, status: next })

        if (next === 'done') {
          api.statsBump('tasks').catch(() => undefined)
        }

        await reload()
      } catch {
        toast.error(t('tasks.saveFailed'))
      }
    },
    [api, project, reload, t]
  )

  const removeTask = useCallback(
    async (task: TaskRow) => {
      try {
        await api.tasksDelete(task.id)
        await reload()
      } catch {
        toast.error(t('tasks.saveFailed'))
      }
    },
    [api, reload, t]
  )

  const saveJira = useCallback(async () => {
    setJiraBusy(true)

    try {
      await api.jiraSetConfig(jira)
      toast.success(t('tasks.jira.saved'))
    } catch {
      toast.error(t('tasks.saveFailed'))
    } finally {
      setJiraBusy(false)
    }
  }, [api, jira, t])

  const importJira = useCallback(async () => {
    setJiraBusy(true)

    try {
      await api.jiraImport()
      await reload()
      toast.success(t('tasks.jira.imported'))
    } catch {
      toast.error(t('tasks.jira.importFailed'))
    } finally {
      setJiraBusy(false)
    }
  }, [api, reload, t])

  // Wallpaper behind the task board (dark overlay keeps rows readable) — same treatment
  // the editor/graph views apply to their backdrop.
  const backgroundImage = ctx.wallpaper
    ? `linear-gradient(rgba(0,0,0,0.62), rgba(0,0,0,0.62)), url("${ctx.wallpaper}")`
    : undefined

  return (
    <Root style={{ backgroundImage, backgroundSize: 'cover', backgroundPosition: 'center' }}>
      <Main>
        <Header>
          <HeaderTitle variant="subtitle1">{t('tasks.title')}</HeaderTitle>

          {activeTask && (
            <Tooltip title={activeTask.branch || ''}>
              <Chip
                size="small"
                color="primary"
                variant="outlined"
                label={`${t('tasks.active')}: ${activeTask.title}`}
                sx={{ maxWidth: 240 }}
              />
            </Tooltip>
          )}

          <Button size="small" variant="outlined" startIcon={<LinkIcon />} onClick={() => setJiraOpen(true)}>
            {t('tasks.jira.connect')}
          </Button>
        </Header>

        <AddRow onSubmit={addTask}>
          <TextField
            size="small"
            fullWidth
            value={newTitle}
            placeholder={t('tasks.add')}
            onChange={(e) => setNewTitle(e.target.value)}
          />

          <Button type="submit" variant="contained" startIcon={<AddIcon />} disabled={!newTitle.trim()}>
            {t('tasks.addBtn')}
          </Button>
        </AddRow>

        <List>
          {tasks.length === 0 ? (
            <Empty>{t('tasks.empty')}</Empty>
          ) : (
            tasks.map((task) => {
              const done = task.status === 'done'

              return (
                <Row key={task.id} $active={task.active} onClick={() => setActive(task)}>
                  <Tooltip title={t(`tasks.status.${task.status}`)}>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation()
                        cycleStatus(task)
                      }}
                      sx={{ color: statusColor[task.status] }}
                    >
                      {done ? (
                        <CheckCircleIcon fontSize="small" />
                      ) : task.status === 'doing' ? (
                        <PlayArrowIcon fontSize="small" />
                      ) : (
                        <RadioButtonUncheckedIcon fontSize="small" />
                      )}
                    </IconButton>
                  </Tooltip>

                  <RowBody>
                    <RowTitle $done={done}>{task.title}</RowTitle>

                    <RowMeta>
                      {task.jiraKey && (
                        <Chip size="small" variant="outlined" label={task.jiraKey} sx={{ height: 18, fontSize: 10 }} />
                      )}

                      {task.branch && (
                        <Chip
                          size="small"
                          variant="outlined"
                          icon={<CallSplitIcon sx={{ fontSize: 12 }} />}
                          label={task.branch}
                          sx={{ height: 18, fontSize: 10, maxWidth: 180 }}
                        />
                      )}
                    </RowMeta>
                  </RowBody>

                  <StatusChipWrap>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={t(`tasks.status.${task.status}`)}
                      sx={{ height: 18, fontSize: 10, borderColor: statusColor[task.status], color: statusColor[task.status] }}
                    />
                  </StatusChipWrap>

                  <Tooltip title={t('fileTree.delete')}>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeTask(task)
                      }}
                      sx={{ color: colors.muted }}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Row>
              )
            })
          )}
        </List>
      </Main>

      <Dialog open={jiraOpen} onClose={() => setJiraOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('tasks.jira.connect')}</DialogTitle>

        <DialogContent>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
            <FormControlLabel
              control={<Checkbox checked={autoBranch} onChange={(e) => setAutoBranch(e.target.checked)} size="small" />}
              label={t('tasks.autoBranch')}
            />

            <TextField
              size="small"
              label={t('tasks.jira.baseUrl')}
              value={jira.baseUrl}
              onChange={(e) => setJira((p) => ({ ...p, baseUrl: e.target.value }))}
            />

            <TextField
              size="small"
              label={t('tasks.jira.email')}
              value={jira.email}
              onChange={(e) => setJira((p) => ({ ...p, email: e.target.value }))}
            />

            <TextField
              size="small"
              type="password"
              label={t('tasks.jira.token')}
              value={jira.token}
              onChange={(e) => setJira((p) => ({ ...p, token: e.target.value }))}
            />

            <TextField
              size="small"
              label={t('tasks.jira.project')}
              value={jira.project}
              onChange={(e) => setJira((p) => ({ ...p, project: e.target.value }))}
            />
          </div>
        </DialogContent>

        <DialogActions>
          <Button onClick={() => setJiraOpen(false)}>{t('tasks.jira.close')}</Button>

          <Button variant="outlined" disabled={jiraBusy} onClick={saveJira}>
            {t('tasks.jira.connect')}
          </Button>

          <Button variant="contained" disabled={jiraBusy || !jira.baseUrl} onClick={importJira}>
            {t('tasks.jira.import')}
          </Button>
        </DialogActions>
      </Dialog>
    </Root>
  )
}
