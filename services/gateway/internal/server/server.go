// Package server implementuje CIENKI api-gateway: cała logika jest w designerze,
// tutaj tylko przekazujemy wywołania (proxy). Brak DB, brak logiki domenowej.
package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"regexp"
	"strings"

	aiv1 "github.com/filipgorny/ai-architect/proto/ai/v1"
	eventsv1 "github.com/filipgorny/ai-architect/proto/events/v1"
	filerv1 "github.com/filipgorny/ai-architect/proto/filer/v1"
	gatewayv1 "github.com/filipgorny/ai-architect/proto/gateway/v1"
)

// Proxy to jedyny punkt wejścia dla Electrona — przekazuje do designera (graf),
// ai (LLM), events (Redis) i filer (operacje na plikach).
type Proxy struct {
	gatewayv1.UnimplementedGatewayServer

	client gatewayv1.GatewayClient
	ai     aiv1.AiClient
	events eventsv1.EventsClient
	filer  filerv1.FilerClient
}

func New(
	client gatewayv1.GatewayClient,
	ai aiv1.AiClient,
	events eventsv1.EventsClient,
	filer filerv1.FilerClient,
) *Proxy {
	return &Proxy{client: client, ai: ai, events: events, filer: filer}
}

var fence = regexp.MustCompile("(?s)^```[a-zA-Z]*\n(.*?)\n```\\s*$")

// AiEdit zmienia kod wg polecenia — przez serwis ai (cały LLM jest tam).
func (p *Proxy) AiEdit(ctx context.Context, req *gatewayv1.AiEditRequest) (*gatewayv1.AiEditResponse, error) {
	resp, err := p.ai.Generate(ctx, &aiv1.GenerateRequest{
		System: "Jesteś asystentem programisty. Zmień podany kod zgodnie z poleceniem. " +
			"Zwróć WYŁĄCZNIE kompletny kod pliku, bez wyjaśnień i bez bloków markdown.",
		Prompt:    "Plik: " + req.GetFile() + "\nPolecenie: " + req.GetPrompt() + "\n\nKod:\n" + req.GetCode(),
		MaxTokens: 8192,
		Dir:       filepath.Dir(req.GetFile()),
	})

	if err != nil {
		return nil, err
	}

	code := resp.GetText()

	if m := fence.FindStringSubmatch(code); m != nil {
		code = m[1]
	}

	return &gatewayv1.AiEditResponse{Code: code}, nil
}

// AiReview prosi ai o uwagi recenzenta do kodu (per linia).
func (p *Proxy) AiReview(ctx context.Context, req *gatewayv1.AiReviewRequest) (*gatewayv1.AiReviewResponse, error) {
	resp, err := p.ai.Generate(ctx, &aiv1.GenerateRequest{
		System: "Jesteś recenzentem kodu. Wskaż istotne uwagi (bugi, ryzyka, czytelność). " +
			"Zwróć WYŁĄCZNIE JSON — tablicę obiektów {\"line\": <numer linii>, \"text\": \"<krótka uwaga>\"}. " +
			"Bez markdown. Gdy kod jest ok, zwróć []." + langInstr(req.GetLang()),
		Prompt:    "Plik: " + req.GetFile() + "\n\nKod (z numerami linii):\n" + withLineNumbers(req.GetCode()),
		MaxTokens: 1200,
		Dir:       filepath.Dir(req.GetFile()),
	})

	if err != nil {
		return nil, err
	}

	out := &gatewayv1.AiReviewResponse{}
	text := resp.GetText()
	i := strings.Index(text, "[")
	j := strings.LastIndex(text, "]")

	if i >= 0 && j > i {
		var raw []struct {
			Line int32  `json:"line"`
			Text string `json:"text"`
		}

		if json.Unmarshal([]byte(text[i:j+1]), &raw) == nil {
			for _, r := range raw {
				if strings.TrimSpace(r.Text) != "" {
					out.Remarks = append(out.Remarks, &gatewayv1.Remark{Line: r.Line, Text: r.Text})
				}
			}
		}
	}

	return out, nil
}

func withLineNumbers(code string) string {
	var b strings.Builder

	for i, l := range strings.Split(code, "\n") {
		fmt.Fprintf(&b, "%d: %s\n", i+1, l)
	}

	return b.String()
}

// AiComplete — podpowiedź autouzupełniania (Copilot) w miejscu kursora.
func (p *Proxy) AiComplete(ctx context.Context, req *gatewayv1.AiCompleteRequest) (*gatewayv1.AiCompleteResponse, error) {
	resp, err := p.ai.Generate(ctx, &aiv1.GenerateRequest{
		System: "Jesteś silnikiem autouzupełniania kodu (jak Copilot). Dokończ kod dokładnie w miejscu znacznika <KURSOR>. " +
			"Zwróć WYŁĄCZNIE tekst do wstawienia w to miejsce — bez wyjaśnień, bez markdown, bez powtarzania istniejącego kodu. " +
			"Jeśli nic sensownego nie da się dopisać, zwróć pusty tekst.",
		Prompt:    "Plik: " + req.GetFile() + "\n\n" + req.GetPrefix() + "<KURSOR>" + req.GetSuffix(),
		MaxTokens: 256,
		Dir:       filepath.Dir(req.GetFile()),
	})

	if err != nil {
		return nil, err
	}

	text := resp.GetText()

	if m := fence.FindStringSubmatch(text); m != nil {
		text = m[1]
	}

	return &gatewayv1.AiCompleteResponse{Text: text}, nil
}

func (p *Proxy) AiModel(ctx context.Context, _ *gatewayv1.Empty) (*gatewayv1.AiModelResponse, error) {
	resp, err := p.ai.Model(ctx, &aiv1.ModelRequest{})

	if err != nil {
		return nil, err
	}

	return &gatewayv1.AiModelResponse{Name: resp.GetName()}, nil
}

func (p *Proxy) AiSetProvider(ctx context.Context, req *gatewayv1.AiProviderRequest) (*gatewayv1.AiModelResponse, error) {
	resp, err := p.ai.SetProvider(ctx, &aiv1.SetProviderRequest{Provider: req.GetProvider()})

	if err != nil {
		return nil, err
	}

	return &gatewayv1.AiModelResponse{Name: resp.GetName()}, nil
}

func (p *Proxy) PublishEvent(ctx context.Context, in *gatewayv1.EventInput) (*gatewayv1.Event, error) {
	e, err := p.events.Publish(ctx, &eventsv1.Event{
		Type: in.GetType(), Title: in.GetTitle(), Body: in.GetBody(),
		AppId: in.GetAppId(), File: in.GetFile(), NodeId: in.GetNodeId(),
	})

	if err != nil {
		return nil, err
	}

	return toGatewayEvent(e), nil
}

func (p *Proxy) ListEvents(ctx context.Context, q *gatewayv1.EventQuery) (*gatewayv1.EventList, error) {
	list, err := p.events.List(ctx, &eventsv1.ListRequest{
		File: q.GetFile(), NodeId: q.GetNodeId(), AppId: q.GetAppId(), Limit: q.GetLimit(),
	})

	if err != nil {
		return nil, err
	}

	out := &gatewayv1.EventList{}

	for _, e := range list.GetEvents() {
		out.Events = append(out.Events, toGatewayEvent(e))
	}

	return out, nil
}

func toGatewayEvent(e *eventsv1.Event) *gatewayv1.Event {
	return &gatewayv1.Event{
		Id: e.GetId(), Type: e.GetType(), Title: e.GetTitle(), Body: e.GetBody(),
		AppId: e.GetAppId(), File: e.GetFile(), NodeId: e.GetNodeId(), CreatedAt: e.GetCreatedAt(),
	}
}

func (p *Proxy) Scan(req *gatewayv1.ScanRequest, out gatewayv1.Gateway_ScanServer) error {
	in, err := p.client.Scan(out.Context(), req)

	if err != nil {
		return err
	}

	return pump(in, out)
}

func (p *Proxy) ScanApp(req *gatewayv1.ScanAppRequest, out gatewayv1.Gateway_ScanAppServer) error {
	in, err := p.client.ScanApp(out.Context(), req)

	if err != nil {
		return err
	}

	return pump(in, out)
}

func (p *Proxy) GetGraph(ctx context.Context, req *gatewayv1.GraphRequest) (*gatewayv1.Graph, error) {
	return p.client.GetGraph(ctx, req)
}

func (p *Proxy) GetAppGraph(ctx context.Context, req *gatewayv1.AppGraphRequest) (*gatewayv1.Graph, error) {
	return p.client.GetAppGraph(ctx, req)
}

func (p *Proxy) ListProjects(ctx context.Context, req *gatewayv1.Empty) (*gatewayv1.Projects, error) {
	return p.client.ListProjects(ctx, req)
}

// progressSource/progressSink unifikują strumienie Scan i ScanApp.
type progressSource interface {
	Recv() (*gatewayv1.Progress, error)
}

type progressSink interface {
	Send(*gatewayv1.Progress) error
}

func pump(in progressSource, out progressSink) error {
	for {
		msg, err := in.Recv()

		if err == io.EOF {
			return nil
		}

		if err != nil {
			return err
		}

		if err := out.Send(msg); err != nil {
			return err
		}
	}
}
