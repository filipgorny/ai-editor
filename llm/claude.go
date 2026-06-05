package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Długoterminowy token OAuth Claude Code (z `claude setup-token`) ustawiany w runtime
// przez serwis ai. Gdy obecny, wstrzykujemy go jako CLAUDE_CODE_OAUTH_TOKEN, więc
// `claude -p` uwierzytelnia się tokenem subskrypcji zamiast interaktywnego logowania.
var (
	claudeTokenMu sync.RWMutex
	claudeToken   string
)

// SetClaudeToken zapamiętuje token OAuth (pusty czyści go).
func SetClaudeToken(tok string) {
	claudeTokenMu.Lock()
	claudeToken = strings.TrimSpace(tok)
	claudeTokenMu.Unlock()
}

// HasClaudeToken mówi, czy jest ustawiony token.
func HasClaudeToken() bool {
	claudeTokenMu.RLock()
	defer claudeTokenMu.RUnlock()

	return claudeToken != ""
}

func currentClaudeToken() string {
	claudeTokenMu.RLock()
	defer claudeTokenMu.RUnlock()

	return claudeToken
}

// ClaudeTokenStore persystuje token OAuth Claude poza pamięcią procesu (np. w Redisie), by
// przeżył restart serwisu. Gdy nie ustawiony, używany jest plik (claudeTokenPath).
type ClaudeTokenStore interface {
	Load() (string, error)
	Save(token string) error
}

var claudeTokenStore ClaudeTokenStore

// SetClaudeTokenStore podłącza zewnętrzny magazyn tokena (wołane przy starcie serwisu, przed
// LoadClaudeToken). nil → zachowanie domyślne (plik).
func SetClaudeTokenStore(s ClaudeTokenStore) {
	claudeTokenStore = s
}

// claudeTokenPath to plik, w którym persystujemy token (wolumen kontenera ai), gdy nie
// podłączono magazynu. Nadpisywalny przez CLAUDE_TOKEN_FILE.
func claudeTokenPath() string {
	if p := os.Getenv("CLAUDE_TOKEN_FILE"); p != "" {
		return p
	}

	return "/data/claude-token"
}

// LoadClaudeToken wczytuje zapisany token (wołane przy starcie serwisu), by `claude -p` był
// uwierzytelniony od razu po restarcie. Z magazynu gdy podłączony, inaczej z pliku.
func LoadClaudeToken() {
	if claudeTokenStore != nil {
		if tok, err := claudeTokenStore.Load(); err == nil {
			SetClaudeToken(tok)
		}

		return
	}

	if b, err := os.ReadFile(claudeTokenPath()); err == nil {
		SetClaudeToken(string(b))
	}
}

// SaveClaudeToken ustawia token w pamięci i persystuje go (magazyn gdy podłączony, inaczej plik).
func SaveClaudeToken(tok string) error {
	SetClaudeToken(tok)

	if claudeTokenStore != nil {
		return claudeTokenStore.Save(currentClaudeToken())
	}

	path := claudeTokenPath()

	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}

	return os.WriteFile(path, []byte(currentClaudeToken()), 0o600)
}

// claudeTimeout caps a single headless run so a stuck CLI (e.g. waiting on an
// unexpected permission prompt) fails fast instead of hanging forever. Applied
// only when the incoming context has no deadline of its own.
const claudeTimeout = 5 * time.Minute

// Claude to dostawca uruchamiający lokalne CLI Claude Code w trybie headless:
// `claude -p` z promptem na stdin (bez limitu długości argumentu). Używa
// subskrypcji Claude Code (OAuth z `claude login`), nie klucza API.
type Claude struct {
	model string // opcjonalny --model
}

func NewClaude(model string) *Claude {
	return &Claude{model: model}
}

func (c *Claude) Name() string {
	if isClaudeModel(c.model) {
		return "claude:" + c.model
	}

	return "claude"
}

// isClaudeModel mówi, czy nazwa modelu pasuje do Claude. Config współdzieli pole
// Model między dostawcami — gdy ustawiony jest model Ollamy (np. "qwen2.5-coder"),
// NIE wolno go przekazać do `claude --model` (404 → exit 1); użyj domyślnego.
func isClaudeModel(m string) bool {
	m = strings.ToLower(m)

	return strings.Contains(m, "claude") ||
		strings.Contains(m, "opus") ||
		strings.Contains(m, "sonnet") ||
		strings.Contains(m, "haiku")
}

// claudeResult to struktura odpowiedzi `--output-format json`.
type claudeResult struct {
	Result  string `json:"result"`
	Subtype string `json:"subtype"`
	IsError bool   `json:"is_error"`
}

func (c *Claude) Generate(ctx context.Context, req Request) (string, error) {
	prompt := req.Prompt

	if req.System != "" {
		prompt = req.System + "\n\n" + req.Prompt
	}

	// Fail fast when the caller didn't set a deadline.
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, claudeTimeout)

		defer cancel()
	}

	// --tools "": wyłącza WSZYSTKIE wbudowane narzędzia Claude (Read/Glob/Grep/Bash…).
	// Kontener ai nie montuje dysku hosta, więc Claude i tak nie czyta plików — kontekst
	// i treści dostarcza aplikacja (skille agenta Ask) oraz gateway. Działa jak czysty
	// generator tekstu/JSON, bez prób sięgania po pliki (i błędów o brak uprawnień).
	// --output-format json: machine-readable result (text in the "result" field).
	args := []string{"-p", "--tools", "", "--output-format", "json"}

	// Only forward --model when it's actually a Claude model; otherwise (e.g. the
	// shared Ollama model name) let claude use its own default to avoid a 404.
	if isClaudeModel(c.model) {
		args = append(args, "--model", c.model)
	}

	bin := claudeBin()
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Stdin = strings.NewReader(prompt)
	cmd.Env = subscriptionEnv(filepath.Dir(bin)) // drop ANTHROPIC_API_KEY → use the Claude Code subscription

	// req.Dir to ścieżka z hosta — w kontenerze ai może nie istnieć (host nie jest
	// montowany). Ustaw katalog roboczy TYLKO gdy faktycznie istnieje, inaczej `claude -p`
	// padłby na chdir do nieistniejącej ścieżki. Bez niego CLI rusza w katalogu kontenera.
	if req.Dir != "" {
		if fi, err := os.Stat(req.Dir); err == nil && fi.IsDir() {
			cmd.Dir = req.Dir
		}
	}

	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	out, err := cmd.Output()

	if err != nil {
		if msg := strings.TrimSpace(stderr.String()); msg != "" {
			return "", fmt.Errorf("claude -p: %w: %s", err, msg)
		}

		return "", fmt.Errorf("claude -p: %w", err)
	}

	// Parse the JSON envelope; fall back to raw text if the format ever differs.
	var res claudeResult

	if json.Unmarshal(bytes.TrimSpace(out), &res) != nil {
		return strings.TrimSpace(string(out)), nil
	}

	if res.IsError {
		return "", fmt.Errorf("claude -p: %s", strings.TrimSpace(res.Result+" "+res.Subtype))
	}

	return strings.TrimSpace(res.Result), nil
}

// claudeBin resolves the Claude Code CLI. The service's PATH may miss the user's bin dir
// (e.g. ~/.local/bin when launched via nodemon/concurrently or a desktop entry), so we fall
// back to common install locations before using the bare name.
func claudeBin() string {
	if p, err := exec.LookPath("claude"); err == nil {
		return p
	}

	home, _ := os.UserHomeDir()
	candidates := []string{
		filepath.Join(home, ".local/bin/claude"),
		filepath.Join(home, "bin/claude"),
		"/usr/local/bin/claude",
		"/opt/homebrew/bin/claude",
		"/usr/bin/claude",
	}

	for _, c := range candidates {
		if fi, err := os.Stat(c); err == nil && !fi.IsDir() {
			return c
		}
	}

	return "claude"
}

// subscriptionEnv returns the process env with ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN
// removed (so the CLI uses the stored Claude Code subscription, not a per-token API key) and
// with the CLI's own dir + ~/.local/bin prepended to PATH so `claude` and its helpers resolve.
func subscriptionEnv(binDir string) []string {
	src := os.Environ()
	out := make([]string, 0, len(src))
	home, _ := os.UserHomeDir()
	extra := binDir + ":" + filepath.Join(home, ".local/bin")
	pathSet := false

	tok := currentClaudeToken()

	for _, kv := range src {
		if strings.HasPrefix(kv, "ANTHROPIC_API_KEY=") || strings.HasPrefix(kv, "ANTHROPIC_AUTH_TOKEN=") {
			continue
		}

		// Stary token z procesu odrzucamy — niżej wstawimy aktualny (jeśli jest).
		if tok != "" && strings.HasPrefix(kv, "CLAUDE_CODE_OAUTH_TOKEN=") {
			continue
		}

		if strings.HasPrefix(kv, "PATH=") {
			out = append(out, "PATH="+extra+":"+strings.TrimPrefix(kv, "PATH="))
			pathSet = true

			continue
		}

		out = append(out, kv)
	}

	if !pathSet {
		out = append(out, "PATH="+extra)
	}

	if tok != "" {
		out = append(out, "CLAUDE_CODE_OAUTH_TOKEN="+tok)
	}

	return out
}
