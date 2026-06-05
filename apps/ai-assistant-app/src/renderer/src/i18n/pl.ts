// Polski słownik — oryginalne napisy z aplikacji.
export default {
  topbar: {
    pickProject: 'Wybierz projekt',
    settings: 'Ustawienia'
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
    language: 'Język',
    ollama: 'Ollama (lokalny)',
    claude: 'Claude (headless)',
    claudeHint:
      'Używa lokalnego CLI <0>claude -p</0> (Claude Code w trybie headless). Wymaga zainstalowanego i zalogowanego <1>claude</1> w systemie.'
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
  common: {
    cancel: 'Anuluj'
  }
}
