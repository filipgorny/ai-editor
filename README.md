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

## Build / run
```bash
# Go (natywnie)
go build ./services/scanner/cmd/scanner
go run ./services/scanner/cmd/scanner -path .

# Bazel (po instalacji bazelisk)
bazel run //:gazelle            # generuje/aktualizuje BUILD.bazel
bazel build //...
bazel run //services/scanner/cmd/scanner -- -path .
```

## Baza danych
```bash
cp .env.example .env
docker compose up -d            # PostgreSQL na localhost:5432
docker compose down             # stop (dane w wolumenie postgres-data)
```

## Model LLM
Używamy natywnego ollama na hoście — model jest już pociągnięty w systemie:
```bash
ollama list                     # -> qwen2.5-coder:14b
```
Aplikacja gada z nim po `OLLAMA_HOST=http://localhost:11434` (patrz `.env.example`).
