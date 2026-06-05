// Package server implements the logs service gRPC: append/list/clear log lines (Postgres).
package server

import (
	"context"

	logsv1 "github.com/filipgorny/ai-architect/proto/logs/v1"
	"github.com/filipgorny/ai-architect/services/logs/internal/store"
)

// Server implements logsv1.LogsServer on top of the store (GORM/Postgres).
type Server struct {
	logsv1.UnimplementedLogsServer

	store *store.Store
}

func New(st *store.Store) *Server {
	return &Server{store: st}
}

func (s *Server) Append(ctx context.Context, req *logsv1.LogBatch) (*logsv1.Empty, error) {
	rows := make([]store.Log, 0, len(req.GetEntries()))

	for _, e := range req.GetEntries() {
		rows = append(rows, store.Log{
			Time:    e.GetTime(),
			Level:   e.GetLevel(),
			Message: e.GetMessage(),
			Source:  e.GetSource(),
		})
	}

	if err := s.store.Append(ctx, rows); err != nil {
		return nil, err
	}

	return &logsv1.Empty{}, nil
}

func (s *Server) ListLogs(ctx context.Context, req *logsv1.LogQuery) (*logsv1.LogList, error) {
	rows, err := s.store.Recent(ctx, int(req.GetLimit()))

	if err != nil {
		return nil, err
	}

	out := &logsv1.LogList{}

	for i := range rows {
		out.Entries = append(out.Entries, toProto(&rows[i]))
	}

	return out, nil
}

func (s *Server) Clear(ctx context.Context, _ *logsv1.Empty) (*logsv1.Empty, error) {
	if err := s.store.Clear(ctx); err != nil {
		return nil, err
	}

	return &logsv1.Empty{}, nil
}

func toProto(l *store.Log) *logsv1.LogEntry {
	return &logsv1.LogEntry{
		Id:      l.ID,
		Time:    l.Time,
		Level:   l.Level,
		Message: l.Message,
		Source:  l.Source,
	}
}
