package server

import (
	"context"

	gatewayv1 "github.com/filipgorny/ai-architect/proto/gateway/v1"
	logsv1 "github.com/filipgorny/ai-architect/proto/logs/v1"
)

// --- App logs: the gateway ONLY forwards to the logs service (its own Postgres database) ---

func (p *Proxy) AppendLogs(ctx context.Context, req *gatewayv1.LogBatch) (*gatewayv1.FileResult, error) {
	batch := &logsv1.LogBatch{}

	for _, e := range req.GetEntries() {
		batch.Entries = append(batch.Entries, &logsv1.LogEntry{
			Time:    e.GetTime(),
			Level:   e.GetLevel(),
			Message: e.GetMessage(),
			Source:  e.GetSource(),
		})
	}

	if _, err := p.logs.Append(ctx, batch); err != nil {
		return nil, err
	}

	return &gatewayv1.FileResult{Ok: true}, nil
}

func (p *Proxy) ListLogs(ctx context.Context, req *gatewayv1.LogQuery) (*gatewayv1.LogList, error) {
	resp, err := p.logs.ListLogs(ctx, &logsv1.LogQuery{Limit: req.GetLimit()})

	if err != nil {
		return nil, err
	}

	out := &gatewayv1.LogList{}

	for _, e := range resp.GetEntries() {
		out.Entries = append(out.Entries, &gatewayv1.LogEntry{
			Id:      e.GetId(),
			Time:    e.GetTime(),
			Level:   e.GetLevel(),
			Message: e.GetMessage(),
			Source:  e.GetSource(),
		})
	}

	return out, nil
}

func (p *Proxy) ClearLogs(ctx context.Context, _ *gatewayv1.Empty) (*gatewayv1.FileResult, error) {
	if _, err := p.logs.Clear(ctx, &logsv1.Empty{}); err != nil {
		return nil, err
	}

	return &gatewayv1.FileResult{Ok: true}, nil
}
