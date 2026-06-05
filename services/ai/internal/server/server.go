// Package server udostępnia agenta AI po gRPC (streaming).
package server

import (
	"context"
	"errors"
	"fmt"

	"github.com/filipgorny/ai-architect/llm"
	aiv1 "github.com/filipgorny/ai-architect/proto/ai/v1"
	"github.com/filipgorny/ai-architect/services/ai/internal/agent"
)

type Server struct {
	aiv1.UnimplementedAiServer

	agent *agent.Agent
}

func New(a *agent.Agent) *Server {
	return &Server{agent: a}
}

// Ask to dwukierunkowy agent ze skillami. Pierwsza wiadomość od aplikacji to 'start'
// (zadanie + kontekst). Skille read_file/list_dir/get_graph deleguje do aplikacji: wysyła
// SkillRequest i czeka na pasujący (po id) SkillResult z tego samego streamu.
func (s *Server) Ask(stream aiv1.Ai_AskServer) error {
	first, err := stream.Recv()

	if err != nil {
		return err
	}

	start := first.GetStart()

	if start == nil {
		return fmt.Errorf("pierwsza wiadomość Ask musi być 'start'")
	}

	emit := func(ev *aiv1.AskEvent) error {
		return stream.Send(ev)
	}

	seq := 0

	skill := func(name, args string) (string, error) {
		seq++
		id := fmt.Sprintf("s%d", seq)

		if err := stream.Send(&aiv1.AskEvent{Event: &aiv1.AskEvent_SkillRequest{
			SkillRequest: &aiv1.SkillRequest{Id: id, Name: name, Args: args},
		}}); err != nil {
			return "", err
		}

		for {
			msg, err := stream.Recv()

			if err != nil {
				return "", err
			}

			res := msg.GetSkillResult()

			if res == nil || res.GetId() != id {
				continue
			}

			if res.GetError() != "" {
				return "", errors.New(res.GetError())
			}

			return res.GetContent(), nil
		}
	}

	return s.agent.Run(stream.Context(), start, emit, skill)
}

func (s *Server) Model(_ context.Context, _ *aiv1.ModelRequest) (*aiv1.ModelResponse, error) {
	return &aiv1.ModelResponse{Name: s.agent.ModelName()}, nil
}

func (s *Server) SetProvider(_ context.Context, req *aiv1.SetProviderRequest) (*aiv1.ModelResponse, error) {
	name, err := s.agent.SetProvider(req.GetProvider())

	if err != nil {
		return nil, err
	}

	return &aiv1.ModelResponse{Name: name}, nil
}

// SetClaudeToken deleguje zapis tokena OAuth Claude do warstwy llm (pamięć + persystencja
// na dysku). `claude -p` użyje go przy następnym wywołaniu.
func (s *Server) SetClaudeToken(_ context.Context, req *aiv1.SetClaudeTokenRequest) (*aiv1.ClaudeTokenStatus, error) {
	if err := llm.SaveClaudeToken(req.GetToken()); err != nil {
		return nil, err
	}

	return &aiv1.ClaudeTokenStatus{HasToken: llm.HasClaudeToken()}, nil
}

// ClaudeStatus mówi, czy serwis ma zapisany token Claude.
func (s *Server) ClaudeStatus(_ context.Context, _ *aiv1.ClaudeStatusRequest) (*aiv1.ClaudeTokenStatus, error) {
	return &aiv1.ClaudeTokenStatus{HasToken: llm.HasClaudeToken()}, nil
}

func (s *Server) Generate(ctx context.Context, req *aiv1.GenerateRequest) (*aiv1.GenerateResponse, error) {
	text, err := s.agent.Generate(ctx, req.GetSystem(), req.GetPrompt(), req.GetTemperature(), int(req.GetMaxTokens()), req.GetDir(), req.GetSession())

	if err != nil {
		return nil, err
	}

	return &aiv1.GenerateResponse{Text: text}, nil
}
