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

const defaultOpenAIBaseURL = "https://api.openai.com/v1"

// OpenAI implementuje Provider przez Chat Completions API (działa też z
// serwerami kompatybilnymi z OpenAI). Podmiana dostawcy = zmiana w configu.
type OpenAI struct {
	baseURL string
	apiKey  string
	model   string
	http    *http.Client
}

func NewOpenAI(baseURL, apiKey, model string) *OpenAI {
	if baseURL == "" {
		baseURL = defaultOpenAIBaseURL
	}

	return &OpenAI{
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  apiKey,
		model:   model,
		http:    &http.Client{Timeout: 180 * time.Second},
	}
}

func (c *OpenAI) Name() string {
	return "openai:" + c.model
}

type openAIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openAIRequest struct {
	Model       string          `json:"model"`
	Messages    []openAIMessage `json:"messages"`
	Temperature float64         `json:"temperature,omitempty"`
	MaxTokens   int             `json:"max_tokens,omitempty"`
}

type openAIResponse struct {
	Choices []struct {
		Message openAIMessage `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func (c *OpenAI) Generate(ctx context.Context, req Request) (string, error) {
	if c.apiKey == "" {
		return "", fmt.Errorf("openai: brak API key")
	}

	msgs := make([]openAIMessage, 0, 2)

	if req.System != "" {
		msgs = append(msgs, openAIMessage{Role: "system", Content: req.System})
	}

	msgs = append(msgs, openAIMessage{Role: "user", Content: req.Prompt})

	body, err := json.Marshal(openAIRequest{
		Model:       c.model,
		Messages:    msgs,
		Temperature: req.Temperature,
		MaxTokens:   req.MaxTokens,
	})

	if err != nil {
		return "", err
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(body))

	if err != nil {
		return "", err
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.http.Do(httpReq)

	if err != nil {
		return "", err
	}

	defer resp.Body.Close()

	var out openAIResponse

	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}

	if out.Error != nil {
		return "", fmt.Errorf("openai: %s", out.Error.Message)
	}

	if len(out.Choices) == 0 {
		return "", fmt.Errorf("openai: pusta odpowiedź")
	}

	return strings.TrimSpace(out.Choices[0].Message.Content), nil
}
