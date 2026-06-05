// Package server implements the scripting service gRPC: CRUD on scripts (Postgres).
package server

import (
	"context"

	scriptingv1 "github.com/filipgorny/ai-architect/proto/scripting/v1"
	"github.com/filipgorny/ai-architect/services/scripting/internal/store"
)

// Server implements scriptingv1.ScriptingServer on top of the store (GORM/Postgres).
type Server struct {
	scriptingv1.UnimplementedScriptingServer

	store *store.Store
}

func New(st *store.Store) *Server {
	return &Server{store: st}
}

func (s *Server) ListScripts(ctx context.Context, req *scriptingv1.ScriptQuery) (*scriptingv1.Scripts, error) {
	rows, err := s.store.List(ctx, req.GetProject())

	if err != nil {
		return nil, err
	}

	out := &scriptingv1.Scripts{}

	for i := range rows {
		out.Scripts = append(out.Scripts, toProto(&rows[i]))
	}

	return out, nil
}

func (s *Server) GetScript(ctx context.Context, req *scriptingv1.ScriptId) (*scriptingv1.Script, error) {
	sc, err := s.store.Get(ctx, req.GetId())

	if err != nil {
		return nil, err
	}

	return toProto(sc), nil
}

func (s *Server) SaveScript(ctx context.Context, req *scriptingv1.Script) (*scriptingv1.Script, error) {
	saved, err := s.store.Save(ctx, &store.Script{
		ID:      req.GetId(),
		Name:    req.GetName(),
		Content: req.GetContent(),
		Project: req.GetProject(),
	})

	if err != nil {
		return nil, err
	}

	return toProto(saved), nil
}

func (s *Server) DeleteScript(ctx context.Context, req *scriptingv1.ScriptId) (*scriptingv1.DeleteResult, error) {
	if err := s.store.Delete(ctx, req.GetId()); err != nil {
		return nil, err
	}

	return &scriptingv1.DeleteResult{Ok: true}, nil
}

func toProto(sc *store.Script) *scriptingv1.Script {
	return &scriptingv1.Script{
		Id:        sc.ID,
		Name:      sc.Name,
		Content:   sc.Content,
		Project:   sc.Project,
		CreatedAt: sc.CreatedAt,
		UpdatedAt: sc.UpdatedAt,
	}
}
