package server

import (
	"context"

	gatewayv1 "github.com/filipgorny/ai-architect/proto/gateway/v1"
	scriptingv1 "github.com/filipgorny/ai-architect/proto/scripting/v1"
)

// --- Scripts: the gateway ONLY forwards to the scripting service (Postgres) ---

func (p *Proxy) ListScripts(ctx context.Context, req *gatewayv1.ScriptQuery) (*gatewayv1.ScriptList, error) {
	resp, err := p.scripting.ListScripts(ctx, &scriptingv1.ScriptQuery{Project: req.GetProject()})

	if err != nil {
		return nil, err
	}

	out := &gatewayv1.ScriptList{}

	for _, sc := range resp.GetScripts() {
		out.Scripts = append(out.Scripts, toGatewayScript(sc))
	}

	return out, nil
}

func (p *Proxy) GetScript(ctx context.Context, req *gatewayv1.ScriptId) (*gatewayv1.Script, error) {
	sc, err := p.scripting.GetScript(ctx, &scriptingv1.ScriptId{Id: req.GetId()})

	if err != nil {
		return nil, err
	}

	return toGatewayScript(sc), nil
}

func (p *Proxy) SaveScript(ctx context.Context, req *gatewayv1.Script) (*gatewayv1.Script, error) {
	sc, err := p.scripting.SaveScript(ctx, &scriptingv1.Script{
		Id:      req.GetId(),
		Name:    req.GetName(),
		Content: req.GetContent(),
		Project: req.GetProject(),
	})

	if err != nil {
		return nil, err
	}

	return toGatewayScript(sc), nil
}

func (p *Proxy) DeleteScript(ctx context.Context, req *gatewayv1.ScriptId) (*gatewayv1.FileResult, error) {
	resp, err := p.scripting.DeleteScript(ctx, &scriptingv1.ScriptId{Id: req.GetId()})

	if err != nil {
		return nil, err
	}

	return &gatewayv1.FileResult{Ok: resp.GetOk()}, nil
}

func toGatewayScript(sc *scriptingv1.Script) *gatewayv1.Script {
	return &gatewayv1.Script{
		Id:        sc.GetId(),
		Name:      sc.GetName(),
		Content:   sc.GetContent(),
		Project:   sc.GetProject(),
		CreatedAt: sc.GetCreatedAt(),
		UpdatedAt: sc.GetUpdatedAt(),
	}
}
