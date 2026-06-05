package server

import (
	"io"

	aiv1 "github.com/filipgorny/ai-architect/proto/ai/v1"
	gatewayv1 "github.com/filipgorny/ai-architect/proto/gateway/v1"
)

// AiAsk proxuje DWUKIERUNKOWY stream agenta ze skillami: Electron ↔ gateway ↔ ai. Aplikacja
// wysyła start (zadanie + kontekst) i wyniki skilli; ai strumieniuje plan, narzędzia,
// żądania skilli i odpowiedź. Skille (read_file/list_dir/get_graph) wykonuje aplikacja.
func (p *Proxy) AiAsk(stream gatewayv1.Gateway_AiAskServer) error {
	up, err := p.ai.Ask(stream.Context())

	if err != nil {
		return err
	}

	errc := make(chan error, 2)

	// aplikacja → ai
	go func() {
		for {
			in, err := stream.Recv()

			if err != nil {
				_ = up.CloseSend()
				errc <- err

				return
			}

			if err := up.Send(toAiClientMsg(in)); err != nil {
				errc <- err

				return
			}
		}
	}()

	// ai → aplikacja
	go func() {
		for {
			ev, err := up.Recv()

			if err != nil {
				errc <- err

				return
			}

			if err := stream.Send(toGatewayAskEvent(ev)); err != nil {
				errc <- err

				return
			}
		}
	}()

	// Pierwszy koniec/błąd zamyka proxy. Normalne zakończenie: ai wysyła answer, Run wraca,
	// stream ai się zamyka → up.Recv() = io.EOF.
	if err := <-errc; err != nil && err != io.EOF {
		return err
	}

	return nil
}

// toAiClientMsg tłumaczy wiadomość aplikacji (typy gateway) na typy serwisu ai.
func toAiClientMsg(in *gatewayv1.AiAskClientMsg) *aiv1.AskClientMsg {
	if s := in.GetStart(); s != nil {
		c := s.GetContext()

		return &aiv1.AskClientMsg{Msg: &aiv1.AskClientMsg_Start{Start: &aiv1.AskRequest{
			Prompt: s.GetPrompt(),
			Edit:   s.GetEdit(),
			Context: &aiv1.AskContext{
				Instruction:  c.GetInstruction(),
				OpenFile:     c.GetOpenFile(),
				SelectedKind: c.GetSelectedKind(),
				SelectedName: c.GetSelectedName(),
				SelectedFile: c.GetSelectedFile(),
			},
		}}}
	}

	if r := in.GetSkillResult(); r != nil {
		return &aiv1.AskClientMsg{Msg: &aiv1.AskClientMsg_SkillResult{SkillResult: &aiv1.SkillResult{
			Id:      r.GetId(),
			Content: r.GetContent(),
			Error:   r.GetError(),
		}}}
	}

	return &aiv1.AskClientMsg{}
}

// toGatewayAskEvent tłumaczy zdarzenie serwisu ai na typy gateway dla aplikacji.
func toGatewayAskEvent(ev *aiv1.AskEvent) *gatewayv1.AiAskEvent {
	switch e := ev.GetEvent().(type) {
	case *aiv1.AskEvent_Plan:
		return &gatewayv1.AiAskEvent{Event: &gatewayv1.AiAskEvent_Plan{Plan: e.Plan}}

	case *aiv1.AskEvent_Tool:
		return &gatewayv1.AiAskEvent{Event: &gatewayv1.AiAskEvent_Tool{Tool: &gatewayv1.AiToolCall{
			Name:   e.Tool.GetName(),
			Args:   e.Tool.GetArgs(),
			Result: e.Tool.GetResult(),
		}}}

	case *aiv1.AskEvent_Answer:
		return &gatewayv1.AiAskEvent{Event: &gatewayv1.AiAskEvent_Answer{Answer: e.Answer}}

	case *aiv1.AskEvent_SkillRequest:
		return &gatewayv1.AiAskEvent{Event: &gatewayv1.AiAskEvent_SkillRequest{SkillRequest: &gatewayv1.AiSkillRequest{
			Id:   e.SkillRequest.GetId(),
			Name: e.SkillRequest.GetName(),
			Args: e.SkillRequest.GetArgs(),
		}}}
	}

	return &gatewayv1.AiAskEvent{}
}
