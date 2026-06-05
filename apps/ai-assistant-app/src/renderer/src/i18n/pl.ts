// Polski słownik — oryginalne napisy z aplikacji.
export default {
  topbar: {
    pickProject: 'Wybierz projekt',
    settings: 'Ustawienia',
    scripts: 'Skrypty'
  },
  empty: {
    title: 'Wybierz folder projektu, aby zobaczyć graf',
    scanLast: 'Skanuj ostatni: {{folder}}'
  },
  agent: {
    placeholderMain: 'W czym mogę pomóc? (dodaj/wypełnij/usuń/zmień nazwę/przenieś pliki i foldery)',
    placeholderEditor: 'W czym mogę pomóc?',
    send: 'Wyślij',
    closeHint: 'Kliknij, aby zamknąć',
    noOps: 'AI nie zwróciło żadnych operacji.',
    opsDone: 'Wykonano operacji: {{count}}',
    error: 'Błąd AI: {{message}}'
  },
  settings: {
    title: 'Ustawienia',
    modelLabel: 'Model AI',
    themeLabel: 'Motyw edytora',
    wallpaperLabel: 'Tapeta',
    language: 'Język',
    ollama: 'Ollama (lokalny)',
    claude: 'Claude (headless)',
    claudeHint:
      'Używa lokalnego CLI "claude -p" (Claude Code w trybie headless). Wymaga zainstalowanego i zalogowanego "claude" w systemie.'
  },
  scan: {
    title: 'Skanowanie projektu…',
    reading: 'Czytam plik:',
    files: 'pliki:',
    entities: 'encje:'
  },
  files: {
    fallback: 'pliki'
  },
  editor: {
    save: 'Zapisz',
    minimize: 'Minimalizuj',
    searchInFile: 'Szukaj w pliku…',
    loading: 'Wczytywanie…',
    unsavedConfirm: 'Masz niezapisane zmiany. Porzucić je?',
    saved: 'Zapisano plik',
    loadError: '// nie udało się wczytać pliku'
  },
  graph: {
    relinkHint: 'Kliknij folder docelowy ({{name}}) — Esc anuluje',
    class: 'Klasa',
    function: 'Funkcja',
    folder: 'Folder',
    addElement: 'Dodaj element',
    rename: 'Zmień nazwę',
    deleteElement: 'Usuń element',
    edit: 'Edytuj',
    searchElement: 'Szukaj elementu…',
    openInEditor: 'Otwórz w edytorze',
    type: 'Typ',
    folderName: 'Nazwa folderu',
    functionName: 'Nazwa funkcji',
    className: 'Nazwa klasy',
    dirName: 'Nazwa katalogu',
    fileName: 'Nazwa pliku',
    add: 'Dodaj',
    change: 'Zmień',
    deleteConfirm: 'Usunąć „{{name}}”?'
  },
  events: {
    open: 'Otwarto plik',
    save: 'Zapisano plik',
    createFolder: 'Dodano folder',
    createElement: 'Dodano element',
    rename: 'Zmieniono nazwę',
    move: 'Przeniesiono plik',
    delete: 'Usunięto element'
  },
  error: {
    render: 'Błąd renderowania'
  },
  scripts: {
    title: 'Skrypty',
    listHeader: 'Skrypty ({{count}})',
    filterAll: 'Wszystkie skrypty',
    filterProject: 'Skrypty tego projektu',
    filterGlobal: 'Skrypty globalne',
    new: 'Nowy skrypt',
    untitled: '(bez nazwy)',
    global: 'globalny',
    attachOnly: 'Tylko w tym projekcie',
    name: 'Nazwa',
    placeholder: '-- Lua. Dostępne: cmd, run, on, onAny, onKey, emit, log, register, api\ncmd("write", "hello z Lua")',
    run: 'Uruchom',
    loadError: 'Nie udało się wczytać skryptów',
    needName: 'Podaj nazwę skryptu',
    saved: 'Zapisano',
    saveFailed: 'Zapis nie powiódł się',
    deleteConfirm: 'Usunąć skrypt?',
    ran: 'Skrypt wykonany',
    runError: 'Błąd skryptu: {{message}}'
  },
  common: {
    cancel: 'Anuluj',
    close: 'Zamknij'
  }
}
