// Package agent to agent AI ze skillami: czytanie pliku, listowanie katalogu,
// sprawdzanie eventów. Najpierw PLANUJE, potem wykonuje narzędzia w pętli.
package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"

	"github.com/filipgorny/ai-architect/llm"
	aiv1 "github.com/filipgorny/ai-architect/proto/ai/v1"
	eventsv1 "github.com/filipgorny/ai-architect/proto/events/v1"
)

type Emit func(*aiv1.AskEvent) error

// Agent łączy LLM ze skillami (narzędziami). Dostawcę można podmienić w locie
// (SetProvider) — np. Ollama → Claude headless — bez restartu serwisu.
type Agent struct {
	mu       sync.RWMutex
	llm      llm.Provider
	cfg      llm.Config
	events   eventsv1.EventsClient
	maxSteps int
}

func New(provider llm.Provider, cfg llm.Config, events eventsv1.EventsClient) *Agent {
	return &Agent{llm: provider, cfg: cfg, events: events, maxSteps: 6}
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

const toolsDesc = `Masz narzędzia (skille):
- read_file: czyta zawartość pliku. args = ścieżka pliku.
- list_dir: listuje katalog (poznanie struktury). args = ścieżka katalogu.
- check_events: zwraca eventy powiązane z plikiem/nodem. args = ścieżka pliku albo id node'a.
- finish: kończ i podaj odpowiedź. args = odpowiedź.
Odpowiadaj WYŁĄCZNIE jednym obiektem JSON, np. {"tool":"read_file","args":"/x/y.ts"} albo {"tool":"finish","args":"..."}.`

// Run realizuje zadanie: plan → pętla narzędzi → odpowiedź.
func (a *Agent) Run(ctx context.Context, req *aiv1.AskRequest, emit Emit) error {
	ctxInfo := ""

	if req.GetFile() != "" {
		ctxInfo += "Plik kontekstu: " + req.GetFile() + "\n"
	}

	if req.GetNodeId() != "" {
		ctxInfo += "Node kontekstu: " + req.GetNodeId() + "\n"
	}

	// 1) Plan przed wykonaniem.
	plan, err := a.prov().Generate(ctx, llm.Request{
		System:      "Jesteś agentem-asystentem kodu. Ułóż zwięzły plan (numerowane kroki) realizacji zadania. Zwróć sam plan.",
		Prompt:      req.GetPrompt() + "\n" + ctxInfo,
		Temperature: 0.2,
		MaxTokens:   300,
	})

	if err != nil {
		return err
	}

	if err := emit(&aiv1.AskEvent{Event: &aiv1.AskEvent_Plan{Plan: plan}}); err != nil {
		return err
	}

	// 2) Pętla narzędzi.
	var history strings.Builder

	for step := 0; step < a.maxSteps; step++ {
		decision, err := a.prov().Generate(ctx, llm.Request{
			System:      toolsDesc,
			Prompt:      fmt.Sprintf("Zadanie: %s\n%sDotychczasowe wyniki:\n%s\nNastępna akcja (JSON):", req.GetPrompt(), ctxInfo, history.String()),
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

		result := a.runTool(ctx, tool, args)

		if err := emit(&aiv1.AskEvent{Event: &aiv1.AskEvent_Tool{
			Tool: &aiv1.ToolCall{Name: tool, Args: args, Result: truncate(result, 400)},
		}}); err != nil {
			return err
		}

		history.WriteString(fmt.Sprintf("- %s(%s) =>\n%s\n", tool, args, truncate(result, 1500)))
	}

	// 3) Odpowiedź końcowa.
	final, err := a.prov().Generate(ctx, llm.Request{
		System:      finalSystem(req.GetEdit()),
		Prompt:      fmt.Sprintf("Zadanie: %s\n%sZebrane informacje:\n%s\nOdpowiedź:", req.GetPrompt(), ctxInfo, history.String()),
		Temperature: 0.2,
		MaxTokens:   2000,
	})

	if err != nil {
		return err
	}

	return emit(answerEvent(final))
}

// ModelName zwraca nazwę używanego modelu LLM.
func (a *Agent) ModelName() string {
	return a.prov().Name()
}

// Generate to proste wywołanie LLM (bez agenta) — jedyna droga do LLM w systemie.
func (a *Agent) Generate(ctx context.Context, system, prompt string, temperature float64, maxTokens int, dir string) (string, error) {
	return a.prov().Generate(ctx, llm.Request{
		System:      system,
		Prompt:      prompt,
		Temperature: temperature,
		MaxTokens:   maxTokens,
		Dir:         dir,
	})
}

func (a *Agent) runTool(ctx context.Context, tool, args string) string {
	switch tool {
	case "read_file":
		data, err := os.ReadFile(args)

		if err != nil {
			return "błąd: " + err.Error()
		}

		return truncate(string(data), 6000)

	case "list_dir":
		entries, err := os.ReadDir(args)

		if err != nil {
			return "błąd: " + err.Error()
		}

		var names []string

		for _, e := range entries {
			names = append(names, e.Name())
		}

		return strings.Join(names, "\n")

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
	return &aiv1.AskEvent{Event: &aiv1.AskEvent_Answer{Answer: s}}
}

func parseDecision(s string) (string, string) {
	i := strings.Index(s, "{")
	j := strings.LastIndex(s, "}")

	if i < 0 || j < i {
		return "", s
	}

	var d struct {
		Tool   string `json:"tool"`
		Args   string `json:"args"`
		Answer string `json:"answer"`
	}

	if json.Unmarshal([]byte(s[i:j+1]), &d) != nil {
		return "", s
	}

	if d.Tool == "" && d.Answer != "" {
		return "finish", d.Answer
	}

	return d.Tool, d.Args
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n] + "…"
	}

	return s
}
