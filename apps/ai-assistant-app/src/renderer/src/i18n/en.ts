// English dictionary — default language for the app.
export default {
  topbar: {
    pickProject: 'Choose project',
    settings: 'Settings'
  },
  empty: {
    title: 'Choose a project folder to see the graph',
    scanLast: 'Scan last: {{folder}}'
  },
  agent: {
    placeholderMain: 'How can I help? (add/fill/delete/rename/move files and folders)',
    placeholderEditor: 'How can I help?',
    send: 'Send',
    closeHint: 'Click to dismiss',
    noOps: 'AI returned no operations.',
    opsDone: 'Operations performed: {{count}}',
    error: 'AI error: {{message}}'
  },
  settings: {
    title: 'Settings',
    modelLabel: 'AI model',
    themeLabel: 'Editor theme',
    language: 'Language',
    ollama: 'Ollama (local)',
    claude: 'Claude (headless)',
    claudeHint:
      'Uses the local <0>claude -p</0> CLI (Claude Code in headless mode). Requires <1>claude</1> installed and logged in on your system.'
  },
  scan: {
    title: 'Scanning project…',
    reading: 'Reading file:',
    files: 'files:',
    entities: 'entities:'
  },
  files: {
    fallback: 'files'
  },
  editor: {
    save: 'Save',
    minimize: 'Minimize',
    searchInFile: 'Search in file…',
    loading: 'Loading…',
    unsavedConfirm: 'You have unsaved changes. Discard them?',
    saved: 'File saved',
    loadError: '// failed to load file'
  },
  graph: {
    relinkHint: 'Click the target folder ({{name}}) — Esc cancels',
    class: 'Class',
    function: 'Function',
    folder: 'Folder',
    addElement: 'Add element',
    rename: 'Rename',
    deleteElement: 'Delete element',
    edit: 'Edit',
    searchElement: 'Search element…',
    openInEditor: 'Open in editor',
    type: 'Type',
    folderName: 'Folder name',
    functionName: 'Function name',
    className: 'Class name',
    dirName: 'Directory name',
    fileName: 'File name',
    add: 'Add',
    change: 'Change',
    deleteConfirm: 'Delete “{{name}}”?'
  },
  events: {
    open: 'File opened',
    save: 'File saved',
    createFolder: 'Folder added',
    createElement: 'Element added',
    rename: 'Renamed',
    move: 'File moved',
    delete: 'Element deleted'
  },
  error: {
    render: 'Render error'
  },
  common: {
    cancel: 'Cancel'
  }
}
