// Polski słownik — oryginalne napisy z aplikacji.
export default {
  topbar: {
    pickProject: 'Wybierz projekt',
    changeProject: 'Zmień projekt',
    settings: 'Ustawienia',
    scripts: 'Skrypty',
    logs: 'Logi'
  },
  review: {
    start: 'Review',
    end: 'Zakończ review',
    changedFiles: 'Zmienione pliki ({{count}})',
    noChanges: 'Brak zmian względem gałęzi bazowej',
    status: {
      new: 'nowy',
      modified: 'zmieniony',
      renamed: 'przeniesiony',
      deleted: 'usunięty'
    }
  },
  empty: {
    title: 'Wybierz folder projektu, aby zobaczyć graf',
    scanLast: 'Skanuj ostatni: {{folder}}'
  },
  agent: {
    placeholderMain: 'W czym mogę pomóc?',
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
    themeVariedDark: '🎲 Różne ciemne — inny dla każdego pliku',
    themeVariedLight: '🎲 Różne jasne — inny dla każdego pliku',
    accentLabel: 'Kolor motywu',
    wallpaperLabel: 'Tapeta',
    language: 'Język',
    ollama: 'Ollama (lokalny)',
    claude: 'Claude (headless)',
    claudeHint:
      'Używa lokalnego CLI "claude -p" (Claude Code w trybie headless). Wymaga zainstalowanego i zalogowanego "claude" w systemie.',
    gitBlameLabel: 'Autorstwo na grafie',
    gitBlameOff: 'Wyłączone',
    gitBlameLast: 'Ostatnio zmieniający',
    rainbowBrackets: 'Kolorowe pary nawiasów'
  },
  scan: {
    title: 'Skanowanie projektu…',
    reading: 'Czytam plik:',
    files: 'pliki:',
    entities: 'encje:'
  },
  files: {
    fallback: 'pliki',
    rename: 'Zmień nazwę',
    delete: 'Usuń',
    renamePrompt: 'Nowa nazwa:',
    deleteConfirm: 'Usunąć „{{name}}”?',
    renamed: 'Zmieniono nazwę',
    deleted: 'Usunięto',
    moved: 'Przeniesiono',
    opFailed: 'Operacja nie powiodła się'
  },
  editor: {
    save: 'Zapisz',
    minimize: 'Minimalizuj',
    searchInFile: 'Szukaj w pliku…',
    loading: 'Wczytywanie…',
    aiNoChange: 'AI nie zwróciło zmian',
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
    runError: 'Błąd skryptu: {{message}}',
    syntaxError: 'Linia {{line}}: {{message}}'
  },
  logs: {
    title: 'Logi',
    clear: 'Wyczyść',
    empty: 'Brak logów. Użyj log(...) w skrypcie.'
  },
  claudeLogin: {
    title: 'Połącz Claude',
    body: 'Dostawca „Claude (headless)” uruchamia claude -p na serwerze. Wygeneruj długoterminowy token, a potem wklej go poniżej — zostanie wysłany na serwer i użyty przy każdym wywołaniu Claude.',
    generate: 'Wygeneruj token (otwiera przeglądarkę)',
    generateHint: 'Otworzy się terminal i zaloguje Cię przez przeglądarkę. Skopiuj wypisany token (sk-ant-oat…) i wklej go tutaj.',
    tokenLabel: 'Token',
    tokenPlaceholder: 'sk-ant-oat…',
    save: 'Zapisz token',
    saved: 'Token zapisany.',
    has: 'Token jest już zapisany na serwerze.',
    none: 'Brak zapisanego tokena.',
    saveFailed: 'Nie udało się zapisać tokena — sprawdź go i spróbuj ponownie.',
    notInstalled: 'Nie znaleziono CLI Claude Code („claude”) na tej maszynie — zainstaluj je, aby wygenerować token, albo wklej token uzyskany gdzie indziej.',
    manualHint: 'Albo uruchom w terminalu:'
  },
  common: {
    cancel: 'Anuluj',
    close: 'Zamknij'
  }
}
