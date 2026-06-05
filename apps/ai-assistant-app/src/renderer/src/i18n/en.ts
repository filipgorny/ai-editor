// English dictionary — default language for the app.
export default {
  topbar: {
    pickProject: 'Choose project',
    changeProject: 'Change project',
    settings: 'Settings',
    scripts: 'Scripts',
    logs: 'Logs'
  },
  review: {
    start: 'Review',
    end: 'End review',
    changedFiles: 'Changed files ({{count}})',
    noChanges: 'No changes vs the base branch',
    status: {
      new: 'new',
      modified: 'modified',
      renamed: 'renamed',
      deleted: 'deleted'
    }
  },
  empty: {
    title: 'Choose a project folder to see the graph',
    scanLast: 'Scan last: {{folder}}'
  },
  agent: {
    placeholderMain: 'How can I help you?',
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
    themeVariedDark: '🎲 Varied dark — different per file',
    themeVariedLight: '🎲 Varied light — different per file',
    accentLabel: 'Accent colour',
    wallpaperLabel: 'Wallpaper',
    language: 'Language',
    ollama: 'Ollama (local)',
    claude: 'Claude (headless)',
    claudeHint:
      'Uses the local "claude -p" CLI (Claude Code in headless mode). Requires "claude" installed and logged in on your system.',
    gitBlameLabel: 'Authorship on graph',
    gitBlameOff: 'Off',
    gitBlameLast: 'Last modifier',
    rainbowBrackets: 'Colored bracket pairs'
  },
  scan: {
    title: 'Scanning project…',
    reading: 'Reading file:',
    files: 'files:',
    entities: 'entities:'
  },
  files: {
    fallback: 'files',
    rename: 'Rename',
    delete: 'Delete',
    renamePrompt: 'New name:',
    deleteConfirm: 'Delete "{{name}}"?',
    renamed: 'Renamed',
    deleted: 'Deleted',
    moved: 'Moved',
    opFailed: 'Operation failed'
  },
  editor: {
    save: 'Save',
    minimize: 'Minimize',
    searchInFile: 'Search in file…',
    loading: 'Loading…',
    aiNoChange: 'AI returned no changes',
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
  scripts: {
    title: 'Scripts',
    listHeader: 'Scripts ({{count}})',
    filterAll: 'All scripts',
    filterProject: "This project's scripts",
    filterGlobal: 'Global scripts',
    new: 'New script',
    untitled: '(unnamed)',
    global: 'global',
    attachOnly: 'Attached to this project only',
    name: 'Name',
    placeholder: '-- Lua. Available: cmd, run, on, onAny, onKey, emit, log, register, api\ncmd("write", "hello from Lua")',
    run: 'Run',
    loadError: 'Failed to load scripts',
    needName: 'Enter a script name',
    saved: 'Saved',
    saveFailed: 'Save failed',
    deleteConfirm: 'Delete script?',
    ran: 'Script executed',
    runError: 'Script error: {{message}}',
    syntaxError: 'Line {{line}}: {{message}}'
  },
  logs: {
    title: 'Logs',
    clear: 'Clear',
    empty: 'No logs yet. Use log(...) in a script.'
  },
  claudeLogin: {
    title: 'Connect Claude',
    body: 'The "Claude (headless)" provider runs claude -p on the server. Generate a long-lived token, then paste it below — it is sent to the server and used for every Claude call.',
    generate: 'Generate token (opens browser)',
    generateHint: 'A terminal opens and signs you in via the browser. Copy the printed token (sk-ant-oat…) and paste it here.',
    tokenLabel: 'Token',
    tokenPlaceholder: 'sk-ant-oat…',
    save: 'Save token',
    saved: 'Token saved.',
    has: 'A token is already saved on the server.',
    none: 'No token saved yet.',
    saveFailed: 'Could not save the token — check it and try again.',
    notInstalled: 'The Claude Code CLI ("claude") was not found on this machine — install it to generate a token, or paste one obtained elsewhere.',
    manualHint: 'Or run in a terminal:'
  },
  common: {
    cancel: 'Cancel',
    close: 'Close'
  }
}
