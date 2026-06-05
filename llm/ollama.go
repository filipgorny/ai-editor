package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const defaultOllamaHost = "http://localhost:11434"

// Ollama implementuje Provider przez lokalne API Ollamy (/api/generate).
type Ollama struct {
	host  string
	model string
	http  *http.Client
}

func NewOllama(host, model string) *Ollama {
	if host == "" {
		host = defaultOllamaHost
	}

	return &Ollama{
		host:  strings.TrimRight(host, "/"),
		model: model,
		http:  &http.Client{Timeout: 180 * time.Second},
	}
}

func (o *Ollama) Name() string {
	return "ollama:" + o.model
}

type ollamaRequest struct {
	Model   string         `json:"model"`
	Prompt  string         `json:"prompt"`
	System  string         `json:"system,omitempty"`
	Stream  bool           `json:"stream"`
	Options map[string]any `json:"options,omitempty"`
}

type ollamaResponse struct {
	Response string `json:"response"`
	Error    string `json:"error"`
}

func (o *Ollama) Generate(ctx context.Context, req Request) (string, error) {
	// Większy kontekst, by model widział cały (np. edytowany) plik, nie tylko
	// domyślne ~2k tokenów.
	opts := map[string]any{"num_ctx": 16384}

	if req.Temperature > 0 {
		opts["temperature"] = req.Temperature
	}

	if req.MaxTokens > 0 {
		opts["num_predict"] = req.MaxTokens
	}

	body, err := json.Marshal(ollamaRequest{
		Model:   o.model,
		Prompt:  req.Prompt,
		System:  req.System,
		Stream:  false,
		Options: opts,
	})

	if err != nil {
		return "", err
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, o.host+"/api/generate", bytes.NewReader(body))

	if err != nil {
		return "", err
	}

	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := o.http.Do(httpReq)

	if err != nil {
		return "", err
	}

	defer resp.Body.Close()

	var out ollamaResponse

	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}

	if out.Error != "" {
		return "", fmt.Errorf("ollama: %s", out.Error)
	}

	return strings.TrimSpace(out.Response), nil
}
