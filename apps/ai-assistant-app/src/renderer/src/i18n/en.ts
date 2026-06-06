// English dictionary — default language for the app.
export default {
  views: {
    editor: 'Editor',
    diagram: 'Code diagram',
    deployment: 'Deployment diagram',
    messages: 'Messages',
    tasks: 'Tasks',
    review: 'Review',
    terminal: 'Terminal',
    browser: 'Web browser',
    empty: 'No file open — pick one from the tree or ask the AI to create one'
  },
  deployment: {
    shapes: 'Shapes',
    arrows: 'Arrows',
    empty: 'Drag or click a shape to start',
    addText: 'Add text',
    save: 'Save',
    open: 'Open',
    export: 'Export',
    exportTitle: 'Export diagram',
    format: 'Format',
    resolution: 'Resolution',
    cancel: 'Cancel',
    shape: {
      rectangle: 'Rectangle',
      database: 'Database',
      cloud: 'Cloud'
    },
    arrow: {
      solid: 'Solid',
      empty: 'Hollow',
      none: 'No head',
      both: 'Both ends'
    }
  },
  terminal: {
    newSession: 'New session',
    closed: 'Session closed',
    unavailable: 'The terminal backend is unavailable on this machine.'
  },
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
    notActive: 'Review mode is off — start a review to see changed files and AI comments.',
    noProject: 'Open a project to review changes.',
    commentCount: '{{count}} comments',
    askAi: 'AI review',
    reviewing: 'Reviewing…',
    noComments: 'No AI comments on the changed lines.',
    reviewFailed: 'Could not get an AI review for this file.',
    lineLabel: 'L{{line}}',
    legend: {
      added: 'added',
      modified: 'modified'
    },
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
    error: 'AI error: {{message}}',
    responding: 'Responding…'
  },
  aiArea: {
    vimHint: 'vim command — Enter to run, e.g. :%s/old/new/g'
  },
  vim: {
    running: 'running…',
    substituted: 'substituted {{count}} occurrence(s)',
    noMatch: 'no match for /{{pattern}}/',
    badPattern: 'invalid pattern',
    saved: 'written',
    closed: 'closed',
    savedClosed: 'written and closed',
    noEditor: 'no active editor',
    unknown: 'not a vim command: :{{cmd}}'
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
    rainbowBrackets: 'Colored bracket pairs',
    rainbow: 'Rainbow brackets',
    tab: {
      general: 'General',
      editor: 'Vim & Copilot'
    },
    vim: 'Vim keybindings',
    copilot: 'Copilot suggestions',
    eachFnColor: 'Each function / class gets its own colour',
    additionalOptions: 'Additional options (experimental)'
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
    addFile: 'Add file',
    addFolder: 'Add folder',
    newFilePrompt: 'File name:',
    newFolderPrompt: 'Folder name:',
    create: 'Create',
    created: 'Created',
    renamePrompt: 'New name:',
    deleteConfirm: 'Delete "{{name}}"?',
    renamed: 'Renamed',
    deleted: 'Deleted',
    moved: 'Moved',
    opFailed: 'Operation failed'
  },
  fileTree: {
    addFile: 'Add file',
    addFolder: 'Add folder',
    rename: 'Rename',
    delete: 'Delete'
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
    deleteConfirm: 'Delete “{{name}}”?',
    editMethods: 'Edit method list',
    methodList: 'Methods (one per line)',
    methodListHint: 'One method name per line. Generating rewrites the file with these methods.',
    describe: 'Describe for AI',
    editDescription: 'Edit AI description',
    descriptionLabel: 'Description',
    descriptionHint: 'Free text that helps the AI implement this class/function.',
    saveDescription: 'Save description',
    generateCode: 'Generate code',
    alreadyImplemented: 'Code already implemented',
    implemented: 'code',
    stub: 'empty'
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
  },
  stats: {
    keystrokes: 'keys',
    lines: 'lines',
    tasks: 'tasks',
    today: 'today'
  },
  messages: {
    empty: 'No messages yet — ask the assistant something to start the log.',
    you: 'You',
    assistant: 'Assistant',
    writingCode: 'code'
  },
  telescope: {
    placeholder: 'Search files and contents…',
    noResults: 'No results',
    searching: 'Searching…',
    matchesIn: 'matches in'
  },
  tasks: {
    title: 'Tasks',
    add: 'Add task',
    addBtn: 'Add',
    active: 'Active',
    empty: 'No tasks yet. Add one above or import from Jira.',
    saveFailed: 'Could not save the task',
    markDone: 'Mark done',
    autoBranch: 'Auto-create a git branch for the active task',
    branchCreated: 'Branch "{{branch}}" ready',
    branchFailed: 'Could not create the git branch',
    status: {
      todo: 'To do',
      doing: 'In progress',
      done: 'Done'
    },
    jira: {
      connect: 'Connect to Jira',
      import: 'Import from Jira',
      imported: 'Imported tasks from Jira',
      importFailed: 'Jira import failed',
      baseUrl: 'Base URL',
      email: 'Email',
      token: 'API token',
      project: 'Project key',
      saved: 'Jira settings saved'
    }
  },
  browser: {
    address: 'Search or type a URL',
    go: 'Go',
    back: 'Back',
    forward: 'Forward',
    reload: 'Reload',
    macros: 'Macros',
    runMacro: 'Run macro',
    recordMacro: 'Save macro',
    newWindow: 'New window',
    newMacro: 'New macro',
    macroName: 'Macro name',
    macroBodyHint: "Lua: type('#email','a@b.com'); click('#submit')",
    macroDone: 'Macro finished.',
    noPage: 'No page is loaded yet.'
  }
}
