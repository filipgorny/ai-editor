// Package server udostępnia agenta AI po gRPC (streaming).
package server

import (
	"context"

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

func (s *Server) Ask(req *aiv1.AskRequest, stream aiv1.Ai_AskServer) error {
	emit := func(ev *aiv1.AskEvent) error {
		return stream.Send(ev)
	}

	return s.agent.Run(stream.Context(), req, emit)
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

func (s *Server) Generate(ctx context.Context, req *aiv1.GenerateRequest) (*aiv1.GenerateResponse, error) {
	text, err := s.agent.Generate(ctx, req.GetSystem(), req.GetPrompt(), req.GetTemperature(), int(req.GetMaxTokens()), req.GetDir())

	if err != nil {
		return nil, err
	}

	return &aiv1.GenerateResponse{Text: text}, nil
}

