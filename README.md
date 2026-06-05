# ai-architect

Monorepo Bazel (bzlmod). Aplikacje Go żyją w `services/<nazwa>`.

## Wymagania
- Bazel przez `.bazelversion` (7.4.1) — zainstaluj `bazelisk` (w systemie go brak, choć `codeagent` go używa).
- Go 1.23+, Docker + docker-compose, ollama (natywny, na hoście).

## Struktura
```
ai-architect/
├── MODULE.bazel              # bzlmod: rules_go 0.56, gazelle 0.43, Go SDK 1.23.4
├── BUILD.bazel               # target gazelle + prefix github.com/filipgorny/ai-architect
├── go.mod                    # github.com/filipgorny/ai-architect
├── docker-compose.yml        # PostgreSQL 16
├── .env.example              # config bazy + ollama
└── services/
    └── scanner/cmd/scanner/  # aplikacja Go (skaner katalogów)
```

## Uruchomienie (Docker + Electron)
Cały backend (8 serwisów Go + PostgreSQL + Redis) chodzi w Dockerze; lokalnie
odpalamy tylko apkę Electron, która gada z gatewayem na `localhost:50061`.
**Hot-reload działa w Dockerze**: zmiana dowolnego pliku `.go` jest wykrywana przez
watcher w kontenerze (CompileDaemon), który rekompiluje i restartuje dany serwis —
bez ręcznego restartu. Realizuje to `docker-compose.dev.yaml` (nakładka dev).
```bash
cp .env.example .env
pnpm dev            # backend (z hot-reloadem) + apka Electron
pnpm down           # stop (dane w wolumenach)
pnpm logs           # logi serwisów (docker compose logs -f)
pnpm restart        # przebuduj/odśwież backend
```

### Tylko backend / bez Electrona
```bash
# z hot-reloadem (nakładka dev):
docker compose -f docker-compose.yml -f docker-compose.dev.yaml up -d --build
# czyste obrazy produkcyjne (bez watchera):
pnpm run up:prod                # = docker compose -f docker-compose.yml up -d --build
docker compose down             # stop (dane w wolumenach postgres-data/redis-data)
```

### Tryb natywny (go run, bez Dockera dla serwisów)
Alternatywa dla hot-reloadu w Dockerze — serwisy lecą natywnie przez `go run`
(nodemon), w Dockerze zostają tylko PostgreSQL i Redis:
```bash
pnpm dev:native
```

## Build / run pojedynczego serwisu
```bash
# Go (natywnie)
go build ./services/scanner/cmd/scanner
go run ./services/scanner/cmd/scanner -path .

# Bazel (po instalacji bazelisk)
bazel run //:gazelle            # generuje/aktualizuje BUILD.bazel
bazel build //...
bazel run //services/scanner/cmd/scanner -- -path .
```

## Model LLM
Używamy natywnego ollama na hoście — model jest już pociągnięty w systemie:
```bash
ollama list                     # -> qwen2.5-coder:14b
```
Aplikacja gada z nim po `OLLAMA_HOST=http://localhost:11434` (patrz `.env.example`).
