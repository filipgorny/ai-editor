// Package agent to agent AI ze skillami: czytanie pliku, listowanie katalogu,
// sprawdzanie eventów. Najpierw PLANUJE, potem wykonuje narzędzia w pętli.
package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"sync"

	"github.com/filipgorny/ai-architect/llm"
	aiv1 "github.com/filipgorny/ai-architect/proto/ai/v1"
	eventsv1 "github.com/filipgorny/ai-architect/proto/events/v1"
	"github.com/filipgorny/ai-architect/services/ai/internal/history"
)

type Emit func(*aiv1.AskEvent) error

// SkillFunc wykonuje skill po stronie APLIKACJI (read_file/list_dir/get_graph) i zwraca
// jego wynik. Serwis ai nie ma dostępu do dysku hosta — dane dostarcza aplikacja.
type SkillFunc func(name, args string) (string, error)

// historyBudget to maksymalny rozmiar (w znakach) historii wstrzykiwanej w prompt.
const historyBudget = 8000

// Agent łączy LLM ze skillami (narzędziami). Dostawcę można podmienić w locie
// (SetProvider) — np. Ollama → Claude headless — bez restartu serwisu.
type Agent struct {
	mu       sync.RWMutex
	llm      llm.Provider
	cfg      llm.Config
	events   eventsv1.EventsClient
	maxSteps int
	hist     *history.Store
}

func New(provider llm.Provider, cfg llm.Config, events eventsv1.EventsClient) *Agent {
	return &Agent{llm: provider, cfg: cfg, events: events, maxSteps: 6, hist: history.New()}
}

// isBigModel mówi, czy bieżący dostawca to „duży" model (chmurowy), dla którego
// warto utrzymywać historię rozmowy. Lokalna Ollama (małe okno kontekstu) — nie.
func (a *Agent) isBigModel() bool {
	a.mu.RLock()
	defer a.mu.RUnlock()

	switch a.cfg.Provider {
	case "claude", "claude-headless", "openai":
		return true

	default:
		return false
	}
}

// prov zwraca bieżącego dostawcę (bezpiecznie przy podmianie).
func (a *Agent) prov() llm.Provider {
	a.mu.RLock()
	defer a.mu.RUnlock()

	return a.llm
}

// SetProvider podmienia dostawcę LLM (np. "ollama" | "claude"), zachowując
// pozostałą konfigurację (model/host). Zwraca nazwę nowego dostawcy.
func (a *Agent) SetProvider(provider string) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	cfg := a.cfg
	cfg.Provider = provider

	p, err := llm.New(cfg)

	if err != nil {
		return "", err
	}

	a.llm = p
	a.cfg = cfg

	return p.Name(), nil
}

// screensDesc opisuje ekrany aplikacji oraz blok <currentView> dołączany do KAŻDEGO
// promptu — JSON z tym, co użytkownik aktualnie widzi (ekran, otwarty plik lub zaznaczony
// element diagramu kodu) oraz listą dostępnych komend (do skilla run_command).
const screensDesc = `Aplikacja ma ekrany (views): editor (edytor kodu w oknach), diagram (graf kodu / Code diagram),
deployment (diagram wdrożenia rysowany kształtami SVG), messages (czat z AI), tasks (zadania + Jira),
review (przegląd zmian), terminal, browser.
Do KAŻDEJ wiadomości dołączam blok <currentView>...</currentView> z JSON-em opisującym, co użytkownik
WIDZI w tej chwili: pole "screen" = aktualny ekran; "file" = ścieżka otwartego pliku (gdy to plik);
"element" = zaznaczony element Code diagram ({kind,name,file}); "commands" = lista komend aplikacji.
Używaj tego do rozwiązywania słów "to/ten/tutaj" — nie pytaj o oczywisty kontekst, jeśli jest w <currentView>.`

const toolsDesc = `Masz narzędzia (skille). read_file/list_dir/get_graph/run_command WYKONUJE APLIKACJA —
NIE czytaj plików samodzielnie, proś o nie skillem:
- read_file: czyta zawartość pliku. args = ścieżka pliku (użyj otwartego pliku z kontekstu, jeśli pasuje).
- list_dir: listuje katalog (poznanie struktury). args = ścieżka katalogu.
- get_graph: zwraca strukturę grafu zależności projektu (węzły/krawędzie). args = puste.
- check_events: zwraca eventy powiązane z plikiem/nodem. args = ścieżka pliku albo id node'a.
- run_command: WYKONUJE komendę aplikacji (np. dodanie kształtu na diagramie SVG). args = "nazwa:argument"
  (np. "add-shape:amazon/ec2,API"). Listę dostępnych komend i ich parametrów masz w <currentView>.commands.
  Używaj run_command, gdy użytkownik prosi o akcję w aplikacji, a nie tylko o odpowiedź tekstową.
- ask_user: zadaj użytkownikowi pytanie z wariantami odpowiedzi (modal). Użyj GDY masz wątpliwości
  albo prompt jest długi/niejednoznaczny — zamiast zgadywać. args = JSON: {"question":"...","options":["...","..."]}.
  Wynik = wybrana odpowiedź użytkownika.
- finish: kończ i podaj odpowiedź. args = odpowiedź.
Odpowiadaj WYŁĄCZNIE jednym obiektem JSON, np. {"tool":"read_file","args":"/x/y.ts"} albo {"tool":"finish","args":"..."}.`

// Run realizuje zadanie: plan → pętla skilli → odpowiedź. Skille read_file/list_dir/get_graph
// wykonuje APLIKACJA (skill), check_events — serwis ai (events). start niesie ujednolicony
// kontekst (instrukcja, otwarty plik, zaznaczony element); treści dobierane są skillami.
func (a *Agent) Run(ctx context.Context, start *aiv1.AskRequest, emit Emit, skill SkillFunc) error {
	prompt := start.GetPrompt()

	if prompt == "" {
		prompt = start.GetContext().GetInstruction()
	}

	ctxInfo := askCtxInfo(start)

	// 1) Plan przed wykonaniem.
	plan, err := a.prov().Generate(ctx, llm.Request{
		System:      "Jesteś agentem-asystentem kodu. " + screensDesc + "\nUłóż zwięzły plan (numerowane kroki) realizacji zadania. Zwróć sam plan.",
		Prompt:      prompt + "\n" + ctxInfo,
		Temperature: 0.2,
		MaxTokens:   300,
	})

	if err != nil {
		return err
	}

	if err := emit(&aiv1.AskEvent{Event: &aiv1.AskEvent_Plan{Plan: plan}}); err != nil {
		return err
	}

	// 2) Pętla skilli.
	var hist strings.Builder

	for step := 0; step < a.maxSteps; step++ {
		decision, err := a.prov().Generate(ctx, llm.Request{
			System:      screensDesc + "\n\n" + toolsDesc,
			Prompt:      fmt.Sprintf("Zadanie: %s\n%sDotychczasowe wyniki:\n%s\nNastępna akcja (JSON):", prompt, ctxInfo, hist.String()),
			Temperature: 0.1,
			MaxTokens:   600,
		})

		if err != nil {
			return err
		}

		tool, args := parseDecision(decision)

		if tool == "finish" {
			return emit(answerEvent(args))
		}

		if tool == "" {
			return emit(answerEvent(decision))
		}

		result := a.runTool(ctx, skill, tool, args)

		if err := emit(&aiv1.AskEvent{Event: &aiv1.AskEvent_Tool{
			Tool: &aiv1.ToolCall{Name: tool, Args: args, Result: truncate(result, 400)},
		}}); err != nil {
			return err
		}

		hist.WriteString(fmt.Sprintf("- %s(%s) =>\n%s\n", tool, args, truncate(result, 1500)))
	}

	// 3) Odpowiedź końcowa.
	final, err := a.prov().Generate(ctx, llm.Request{
		System:      finalSystem(start.GetEdit()),
		Prompt:      fmt.Sprintf("Zadanie: %s\n%sZebrane informacje:\n%s\nOdpowiedź:", prompt, ctxInfo, hist.String()),
		Temperature: 0.2,
		MaxTokens:   2000,
	})

	if err != nil {
		return err
	}

	return emit(answerEvent(final))
}

// askCtxInfo buduje zwięzły opis kontekstu (otwarty plik, zaznaczony element, node) do
// promptu. Treści NIE wstrzykuje — od tego są skille read_file/get_graph.
func askCtxInfo(start *aiv1.AskRequest) string {
	var sb strings.Builder
	c := start.GetContext()

	if f := firstNonEmpty(c.GetOpenFile(), start.GetFile()); f != "" {
		sb.WriteString("Otwarty plik (kontekst dla 'ten/to'): " + f + "\n")
	}

	if c.GetSelectedFile() != "" || c.GetSelectedName() != "" {
		sb.WriteString(fmt.Sprintf("Zaznaczony element: %s %s (%s)\n", c.GetSelectedKind(), c.GetSelectedName(), c.GetSelectedFile()))
	}

	if start.GetNodeId() != "" {
		sb.WriteString("Node kontekstu: " + start.GetNodeId() + "\n")
	}

	return sb.String()
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}

	return b
}

// ModelName zwraca nazwę używanego modelu LLM.
func (a *Agent) ModelName() string {
	return a.prov().Name()
}

// Generate to proste wywołanie LLM (bez agenta) — jedyna droga do LLM w systemie.
// Gdy podano session i bieżący model jest „duży", do promptu dołączana jest
// historia rozmowy (pamięć kontekstu), a nowa tura jest w niej zapisywana.
func (a *Agent) Generate(ctx context.Context, system, prompt string, temperature float64, maxTokens int, dir, session string) (string, error) {
	useHistory := session != "" && a.isBigModel()
	full := prompt

	if useHistory {
		if prior := a.hist.Render(session, historyBudget); prior != "" {
			full = "Wcześniejsza rozmowa (kontekst):\n" + prior + "\nNowe polecenie:\n" + prompt
		}
	}

	text, err := a.prov().Generate(ctx, llm.Request{
		System:      system,
		Prompt:      full,
		Temperature: temperature,
		MaxTokens:   maxTokens,
		Dir:         dir,
	})

	if err != nil {
		return "", err
	}

	if useHistory {
		a.hist.Append(session, "user", prompt)
		a.hist.Append(session, "assistant", text)
	}

	return text, nil
}

// ResetHistory czyści pamięć rozmowy dla sesji (np. nowa rozmowa).
func (a *Agent) ResetHistory(session string) {
	a.hist.Clear(session)
}

func (a *Agent) runTool(ctx context.Context, skill SkillFunc, tool, args string) string {
	switch tool {
	case "read_file", "list_dir", "get_graph", "ask_user", "run_command":
		out, err := skill(tool, args)

		if err != nil {
			return "błąd: " + err.Error()
		}

		return out

	case "check_events":
		list, err := a.events.List(ctx, &eventsv1.ListRequest{File: args, NodeId: args, Limit: 20})

		if err != nil {
			return "błąd: " + err.Error()
		}

		if len(list.GetEvents()) == 0 {
			return "brak powiązanych eventów"
		}

		var sb strings.Builder

		for _, e := range list.GetEvents() {
			sb.WriteString(fmt.Sprintf("[%s] %s: %s\n", e.GetType(), e.GetTitle(), e.GetBody()))
		}

		return sb.String()
	}

	return "nieznane narzędzie: " + tool
}

func finalSystem(edit bool) string {
	if edit {
		return "Jesteś asystentem programisty. Zwróć WYŁĄCZNIE kompletny, zmodyfikowany kod pliku — bez wyjaśnień i bez bloków markdown."
	}

	return "Jesteś asystentem kodu. Odpowiedz zwięźle po polsku na podstawie zebranych informacji."
}

func answerEvent(s string) *aiv1.AskEvent {
	return &aiv1.AskEvent{Event: &aiv1.AskEvent_Answer{Answer: sanitizeAnswer(s)}}
}

// toolCallTagRe matches <tool_call>...</tool_call> blocks (some local models, e.g.
// Ollama qwen2.5-coder, wrap their tool calls this way). Multi-line aware.
var toolCallTagRe = regexp.MustCompile(`(?is)<tool_call>.*?</tool_call>`)

// toolJSONRe matches a standalone JSON object describing a tool call, e.g.
// {"tool":"finish","args":"..."} — including object-form args ({"args":{...}}).
var toolJSONRe = regexp.MustCompile(`\{[^{}]*"tool"\s*:\s*"[^"]*"(?:[^{}]|\{[^{}]*\})*\}`)

// sanitizeAnswer strips raw tool-call protocol fragments from user-facing answer
// text so the model's internal tool/skill calls never leak into the chat. It is a
// defensive net for cases where the model emits a tool call where plain prose was
// expected (or wraps it in tags the agent loop did not route).
func sanitizeAnswer(s string) string {
	out := toolCallTagRe.ReplaceAllString(s, "")
	out = toolJSONRe.ReplaceAllString(out, "")

	return strings.TrimSpace(out)
}

// stripToolCallTag unwraps a single <tool_call>...</tool_call> block, returning its
// inner content so the JSON tool call inside can be parsed and routed.
func stripToolCallTag(s string) string {
	open := strings.Index(s, "<tool_call>")

	if open < 0 {
		return s
	}

	rest := s[open+len("<tool_call>"):]
	close := strings.Index(rest, "</tool_call>")

	if close < 0 {
		return rest
	}

	return rest[:close]
}

func parseDecision(s string) (string, string) {
	s = stripToolCallTag(s)

	i := strings.Index(s, "{")
	j := strings.LastIndex(s, "}")

	if i < 0 || j < i {
		return "", s
	}

	raw := s[i : j+1]

	// First try args as a plain string: {"tool":"read_file","args":"/x/y.ts"}.
	var d struct {
		Tool   string `json:"tool"`
		Args   string `json:"args"`
		Answer string `json:"answer"`
	}

	if json.Unmarshal([]byte(raw), &d) == nil {
		if d.Tool == "" && d.Answer != "" {
			return "finish", d.Answer
		}

		return d.Tool, d.Args
	}

	// Fallback: args as an object/array (e.g. {"tool":"ask_user","args":{...}}).
	// Keep args as raw JSON so the relevant skill can interpret it.
	var obj struct {
		Tool string          `json:"tool"`
		Args json.RawMessage `json:"args"`
	}

	if json.Unmarshal([]byte(raw), &obj) == nil && obj.Tool != "" {
		return obj.Tool, strings.TrimSpace(string(obj.Args))
	}

	// Unparseable: treat as plain text, but sanitized so no raw protocol leaks.
	return "", sanitizeAnswer(s)
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n] + "…"
	}

	return s
}
