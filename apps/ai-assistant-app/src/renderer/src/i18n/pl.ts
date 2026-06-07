// Polski słownik — oryginalne napisy z aplikacji.
export default {
  views: {
    editor: 'Edytor',
    diagram: 'Diagram kodu',
    deployment: 'Diagram wdrożenia',
    messages: 'Wiadomości',
    tasks: 'Zadania',
    review: 'Recenzja',
    terminal: 'Terminal',
    browser: 'Przeglądarka',
    empty: 'Brak otwartego pliku — wybierz go z drzewa lub poproś AI o utworzenie'
  },
  deployment: {
    shapes: 'Kształty',
    connectors: 'Łączniki',
    search: 'Znajdź grafikę…',
    noResults: 'Brak pasujących grafik',
    empty: 'Przeciągnij lub kliknij kształt, aby zacząć',
    addText: 'Dodaj tekst',
    save: 'Zapisz',
    open: 'Otwórz',
    export: 'Eksport',
    exportTitle: 'Eksportuj diagram',
    format: 'Format',
    resolution: 'Rozdzielczość',
    cancel: 'Anuluj',
    category: {
      basic: 'Podstawowe',
      deployment: 'Wdrożenie'
    },
    shape: {
      rectangle: 'Prostokąt',
      database: 'Baza danych',
      cloud: 'Chmura',
      ec2: 'EC2',
      ecs: 'ECS',
      s3: 'S3',
      rds: 'RDS',
      redshift: 'Redshift',
      documentdb: 'DocumentDB'
    },
    connector: {
      solid: 'Strzałka',
      empty: 'Pusta strzałka',
      both: 'Dwustronna',
      none: 'Linia',
      dashed: 'Linia przerywana',
      erOne: 'Jeden do jednego',
      erMany: 'Wiele (kurza stopka)',
      erOneMany: 'Jeden do wielu'
    }
  },
  terminal: {
    newSession: 'Nowa sesja',
    closed: 'Sesja zakończona',
    unavailable: 'Backend terminala jest niedostępny na tym komputerze.'
  },
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
    notActive: 'Tryb review jest wyłączony — uruchom review, aby zobaczyć zmienione pliki i komentarze AI.',
    noProject: 'Otwórz projekt, aby przejrzeć zmiany.',
    commentCount: '{{count}} komentarzy',
    askAi: 'Review AI',
    reviewing: 'Przeglądanie…',
    noComments: 'Brak komentarzy AI na zmienionych liniach.',
    reviewFailed: 'Nie udało się uzyskać recenzji AI dla tego pliku.',
    lineLabel: 'L{{line}}',
    legend: {
      added: 'dodane',
      modified: 'zmienione'
    },
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
    error: 'Błąd AI: {{message}}',
    responding: 'Odpowiadam…'
  },
  aiArea: {
    vimHint: 'komenda vim — Enter, aby uruchomić, np. :%s/raz/dwa/g'
  },
  vim: {
    running: 'wykonuję…',
    substituted: 'zamieniono {{count}} wystąpień',
    noMatch: 'brak dopasowania dla /{{pattern}}/',
    badPattern: 'nieprawidłowy wzorzec',
    saved: 'zapisano',
    closed: 'zamknięto',
    savedClosed: 'zapisano i zamknięto',
    noEditor: 'brak aktywnego edytora',
    unknown: 'to nie jest komenda vim: :{{cmd}}'
  },
  settings: {
    title: 'Ustawienia',
    modelLabel: 'Model AI',
    themeLabel: 'Motyw edytora',
    themeVariedDark: '🎲 Różne ciemne — inny dla każdego pliku',
    themeVariedLight: '🎲 Różne jasne — inny dla każdego pliku',
    themeAutogenDark: '🧬 Autogenerowane ciemne — z nazwy i pakietu',
    themeAutogenLight: '🧬 Autogenerowane jasne — z nazwy i pakietu',
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
    rainbowBrackets: 'Kolorowe pary nawiasów',
    rainbow: 'Tęczowe nawiasy',
    tab: {
      general: 'Ogólne',
      editor: 'Vim i Copilot'
    },
    vim: 'Skróty klawiszowe Vim',
    copilot: 'Podpowiedzi Copilot',
    eachFnColor: 'Każda funkcja / klasa ma swój kolor',
    additionalOptions: 'Opcje dodatkowe (eksperymentalne)'
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
    addFile: 'Dodaj plik',
    addFolder: 'Dodaj folder',
    newFilePrompt: 'Nazwa pliku:',
    newFolderPrompt: 'Nazwa folderu:',
    create: 'Utwórz',
    created: 'Utworzono',
    renamePrompt: 'Nowa nazwa:',
    deleteConfirm: 'Usunąć „{{name}}”?',
    renamed: 'Zmieniono nazwę',
    deleted: 'Usunięto',
    moved: 'Przeniesiono',
    opFailed: 'Operacja nie powiodła się'
  },
  fileTree: {
    addFile: 'Dodaj plik',
    addFolder: 'Dodaj folder',
    rename: 'Zmień nazwę',
    delete: 'Usuń'
  },
  editor: {
    save: 'Zapisz',
    minimize: 'Minimalizuj',
    searchInFile: 'Szukaj w pliku…',
    loading: 'Wczytywanie…',
    aiNoChange: 'AI nie zwróciło zmian',
    unsavedConfirm: 'Masz niezapisane zmiany. Porzucić je?',
    saved: 'Zapisano plik',
    loadError: '// nie udało się wczytać pliku',
    clearTabs: 'Wyczyść',
    clearTabsTitle: 'Zamknij wszystkie otwarte okna'
  },
  graph: {
    relinkHint: 'Kliknij folder docelowy ({{name}}) — Esc anuluje',
    class: 'Klasa',
    function: 'Funkcja',
    folder: 'Folder',
    addElement: 'Dodaj element',
    elementOptions: 'Opcje elementu',
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
    deleteConfirm: 'Usunąć „{{name}}”?',
    editMethods: 'Edytuj listę metod',
    methodList: 'Metody (jedna na linię)',
    methodListHint: 'Jedna nazwa metody na linię. Generowanie nadpisuje plik tymi metodami.',
    describe: 'Opisz dla AI',
    editDescription: 'Edytuj opis dla AI',
    descriptionLabel: 'Opis',
    descriptionHint: 'Tekst pomagający AI zaimplementować tę klasę/funkcję.',
    saveDescription: 'Zapisz opis',
    generateCode: 'Wygeneruj kod',
    alreadyImplemented: 'Kod już zaimplementowany',
    implemented: 'kod',
    stub: 'pusta',
    run: 'Uruchom',
    runApp: 'Uruchom aplikację',
    langUnknown: 'język ?',
    runFailed: 'Nie udało się uruchomić aplikacji',
    cancel: 'Anuluj',
    runAnyway: 'Uruchom mimo to',
    apiWarnTitle: 'API jest nieosiągalne',
    apiWarnBody:
      'Ta aplikacja łączy się z API pod adresem {{url}}, które może być wymagane do jej działania. API wygląda na niedziałające. Czy na pewno chcesz uruchomić aplikację?'
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
  },
  stats: {
    keystrokes: 'klawiszy',
    lines: 'linii',
    tasks: 'zadań',
    today: 'dziś'
  },
  messages: {
    empty: 'Brak wiadomości — zapytaj asystenta, aby rozpocząć log.',
    you: 'Ty',
    assistant: 'Asystent',
    writingCode: 'kod'
  },
  telescope: {
    placeholder: 'Szukaj plików i treści…',
    noResults: 'Brak wyników',
    searching: 'Szukam…',
    matchesIn: 'dopasowania w'
  },
  tasks: {
    title: 'Zadania',
    add: 'Dodaj zadanie',
    addBtn: 'Dodaj',
    active: 'Aktywne',
    empty: 'Brak zadań. Dodaj zadanie powyżej lub zaimportuj z Jiry.',
    saveFailed: 'Nie udało się zapisać zadania',
    markDone: 'Oznacz jako zrobione',
    autoBranch: 'Automatycznie twórz gałąź git dla aktywnego zadania',
    branchCreated: 'Gałąź „{{branch}}” gotowa',
    branchFailed: 'Nie udało się utworzyć gałęzi git',
    status: {
      todo: 'Do zrobienia',
      doing: 'W trakcie',
      done: 'Zrobione'
    },
    jira: {
      connect: 'Połącz z Jirą',
      import: 'Importuj z Jiry',
      imported: 'Zaimportowano zadania z Jiry',
      importFailed: 'Import z Jiry nie powiódł się',
      baseUrl: 'Adres bazowy',
      email: 'E-mail',
      token: 'Token API',
      project: 'Klucz projektu',
      saved: 'Zapisano ustawienia Jiry',
      close: 'Zamknij'
    }
  },
  browser: {
    address: 'Wyszukaj lub wpisz adres URL',
    go: 'Idź',
    back: 'Wstecz',
    forward: 'Dalej',
    reload: 'Odśwież',
    macros: 'Makra',
    runMacro: 'Uruchom makro',
    recordMacro: 'Zapisz makro',
    newWindow: 'Nowe okno',
    newMacro: 'Nowe makro',
    macroName: 'Nazwa makra',
    macroBodyHint: "Lua: type('#email','a@b.com'); click('#submit')",
    macroDone: 'Makro zakończone.',
    noPage: 'Nie wczytano jeszcze strony.'
  }
}
