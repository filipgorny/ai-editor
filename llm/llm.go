// Package llm to warstwa abstrakcji nad dostawcami modeli (LLM). Dzięki niej
// Ollamę można później podmienić np. na OpenAI bez zmian w reszcie kodu —
// wystarczy inny wpis w config/scanner.yaml.
package llm

import (
	"context"
	"fmt"
)

// Request to pojedyncze zapytanie generacyjne, niezależne od dostawcy.
type Request struct {
	System      string
	Prompt      string
	Temperature float64
	MaxTokens   int
}

// Provider to dowolny backend generujący tekst (Ollama, OpenAI, ...).
type Provider interface {
	// Name zwraca etykietę dostawcy (do logów), np. "ollama:qwen2.5-coder:14b".
	Name() string
	// Generate wykonuje pojedyncze zapytanie i zwraca wygenerowany tekst.
	Generate(ctx context.Context, req Request) (string, error)
}

// Config wybiera i konfiguruje dostawcę.
type Config struct {
	Provider string `yaml:"provider"` // "ollama" | "openai"
	Model    string `yaml:"model"`

	// Ollama
	Host string `yaml:"host"`

	// OpenAI (i serwery kompatybilne)
	APIKey  string `yaml:"api_key"`
	BaseURL string `yaml:"base_url"`
}

// New tworzy dostawcę na podstawie konfiguracji.
func New(cfg Config) (Provider, error) {
	switch cfg.Provider {
	case "", "ollama":
		return NewOllama(cfg.Host, cfg.Model), nil

	case "openai":
		return NewOpenAI(cfg.BaseURL, cfg.APIKey, cfg.Model), nil

	default:
		return nil, fmt.Errorf("llm: nieznany dostawca %q", cfg.Provider)
	}
}
