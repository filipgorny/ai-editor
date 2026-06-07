// Deployment-diagram command DECLARATIONS (the "commands" half of the CQRS split).
//
// These are pure declarations — name, group, expected argument, summary — with NO behaviour.
// They are added to the Commander catalog at startup so the help, the command palette and the
// AI always know the commands exist. The matching HANDLERS are registered separately by
// DeploymentView (the screen that owns the behaviour) while it is mounted; see that file's
// commander.bindHandlers(...) call. Command names are the shared contract between the two.

import type { CommandDef } from '../Commander'

export const ADD_SHAPE = 'add-shape'
export const CONNECT = 'connect'
export const SET_ARROW = 'set-arrow'
export const DELETE_SELECTED = 'delete-selected'
export const CLEAR_DIAGRAM = 'clear-diagram'

const ARROW_STYLES = 'solid|empty|both|none|dashed|erOne|erMany|erOneMany'

export const deploymentCommands: CommandDef[] = [
  {
    name: ADD_SHAPE,
    group: 'Diagram',
    params: 'kind[,label]  (np. amazon/ec2,API albo basic/rectangle,Baza)',
    summary: 'Dodaje kształt na diagramie wdrożenia (SVG).'
  },
  {
    name: CONNECT,
    group: 'Diagram',
    params: `sourceLabel,targetLabel[,style]  (style: ${ARROW_STYLES})`,
    summary: 'Łączy strzałką dwa kształty po ich etykietach.'
  },
  {
    name: SET_ARROW,
    group: 'Diagram',
    params: ARROW_STYLES,
    summary: 'Ustawia styl łącznika dla nowych (i zaznaczonego) połączeń.'
  },
  {
    name: DELETE_SELECTED,
    group: 'Diagram',
    params: '—',
    summary: 'Usuwa zaznaczony kształt (z połączeniami) lub zaznaczone połączenie.'
  },
  {
    name: CLEAR_DIAGRAM,
    group: 'Diagram',
    params: '—',
    summary: 'Usuwa wszystkie kształty i połączenia.'
  }
]
