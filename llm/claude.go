package llm

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
)

// Claude to dostawca uruchamiający lokalne CLI Claude Code w trybie headless:
// `claude -p` z promptem na stdin (bez limitu długości argumentu). Wymaga
// zainstalowanego i zalogowanego `claude` w systemie.
type Claude struct {
	model string // opcjonalny --model
}

func NewClaude(model string) *Claude {
	return &Claude{model: model}
}

func (c *Claude) Name() string {
	if c.model != "" {
		return "claude:" + c.model
	}

	return "claude"
}

func (c *Claude) Generate(ctx context.Context, req Request) (string, error) {
	prompt := req.Prompt

	if req.System != "" {
		prompt = req.System + "\n\n" + req.Prompt
	}

	args := []string{"-p"}

	if c.model != "" {
		args = append(args, "--model", c.model)
	}

	cmd := exec.CommandContext(ctx, "claude", args...)
	cmd.Stdin = strings.NewReader(prompt)

	if req.Dir != "" {
		cmd.Dir = req.Dir // uruchom w katalogu projektu
	}

	out, err := cmd.Output()

	if err != nil {
		return "", fmt.Errorf("claude -p: %w", err)
	}

	return strings.TrimSpace(string(out)), nil
}
