package server

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"

	aiv1 "github.com/filipgorny/ai-architect/proto/ai/v1"
	filerv1 "github.com/filipgorny/ai-architect/proto/filer/v1"
	gatewayv1 "github.com/filipgorny/ai-architect/proto/gateway/v1"
)

// --- Proxy operacji na plikach: gateway → filer (jedyny dotykający fs) ---

func (p *Proxy) ReadFile(ctx context.Context, req *gatewayv1.FilePath) (*gatewayv1.FileContent, error) {
	resp, err := p.filer.Read(ctx, &filerv1.PathReq{Path: req.GetPath()})

	if err != nil {
		return nil, err
	}

	return &gatewayv1.FileContent{Content: resp.GetContent()}, nil
}

func (p *Proxy) SaveFile(ctx context.Context, req *gatewayv1.SaveRequest) (*gatewayv1.FileResult, error) {
	resp, err := p.filer.Save(ctx, &filerv1.SaveReq{Path: req.GetPath(), Content: req.GetContent()})

	return toFileResult(resp), err
}

func (p *Proxy) CreateFile(ctx context.Context, req *gatewayv1.CreateRequest) (*gatewayv1.FileResult, error) {
	resp, err := p.filer.Create(ctx, &filerv1.CreateReq{Dir: req.GetDir(), File: req.GetFile(), Name: req.GetName()})

	return toFileResult(resp), err
}

func (p *Proxy) CreateFolder(ctx context.Context, req *gatewayv1.CreateFolderRequest) (*gatewayv1.FileResult, error) {
	resp, err := p.filer.Mkdir(ctx, &filerv1.MkdirReq{Dir: req.GetDir(), Name: req.GetName()})

	return toFileResult(resp), err
}

func (p *Proxy) RenameFile(ctx context.Context, req *gatewayv1.RenameRequest) (*gatewayv1.FileResult, error) {
	resp, err := p.filer.Rename(ctx, &filerv1.RenameReq{
		OldPath:   req.GetOldPath(),
		FileBase:  req.GetFileBase(),
		ClassName: req.GetClassName(),
		OldName:   req.GetOldName(),
	})

	return toFileResult(resp), err
}

func (p *Proxy) MoveFile(ctx context.Context, req *gatewayv1.MoveRequest) (*gatewayv1.FileResult, error) {
	resp, err := p.filer.Move(ctx, &filerv1.MoveReq{OldPath: req.GetOldPath(), TargetDir: req.GetTargetDir()})

	return toFileResult(resp), err
}

func (p *Proxy) DeletePath(ctx context.Context, req *gatewayv1.FilePath) (*gatewayv1.FileResult, error) {
	resp, err := p.filer.Delete(ctx, &filerv1.PathReq{Path: req.GetPath()})

	return toFileResult(resp), err
}

func (p *Proxy) ResolveImport(ctx context.Context, req *gatewayv1.ResolveRequest) (*gatewayv1.FileResult, error) {
	resp, err := p.filer.Resolve(ctx, &filerv1.ResolveReq{From: req.GetFrom(), Spec: req.GetSpec()})

	return toFileResult(resp), err
}

func toFileResult(r *filerv1.Result) *gatewayv1.FileResult {
	if r == nil {
		return &gatewayv1.FileResult{}
	}

	return &gatewayv1.FileResult{Path: r.GetPath(), Ok: r.GetOk()}
}

// --- Przeglądanie dysku / szukanie projektów: gateway → filer ---

func (p *Proxy) HomeDir(ctx context.Context, _ *gatewayv1.Empty) (*gatewayv1.FileResult, error) {
	resp, err := p.filer.Home(ctx, &filerv1.Empty{})

	return toFileResult(resp), err
}

func (p *Proxy) ListDir(ctx context.Context, req *gatewayv1.FilePath) (*gatewayv1.DirListing, error) {
	resp, err := p.filer.ListDir(ctx, &filerv1.PathReq{Path: req.GetPath()})

	if err != nil {
		return nil, err
	}

	out := &gatewayv1.DirListing{Path: resp.GetPath(), Parent: resp.GetParent()}

	for _, e := range resp.GetEntries() {
		out.Entries = append(out.Entries, &gatewayv1.DirEntry{Name: e.GetName(), Path: e.GetPath(), Dir: e.GetDir()})
	}

	return out, nil
}

// SaveGraphState / GetGraphState — proxy to the designer (Postgres).
func (p *Proxy) SaveGraphState(ctx context.Context, req *gatewayv1.GraphStateRequest) (*gatewayv1.FileResult, error) {
	return p.client.SaveGraphState(ctx, req)
}

func (p *Proxy) GetGraphState(ctx context.Context, req *gatewayv1.GraphStateKey) (*gatewayv1.GraphStateResponse, error) {
	return p.client.GetGraphState(ctx, req)
}

func (p *Proxy) DetectConventions(ctx context.Context, req *gatewayv1.FilePath) (*gatewayv1.Conventions, error) {
	resp, err := p.filer.Conventions(ctx, &filerv1.PathReq{Path: req.GetPath()})

	if err != nil {
		return nil, err
	}

	return &gatewayv1.Conventions{Convention: resp.GetConvention(), Extension: resp.GetExtension()}, nil
}

func (p *Proxy) FindProjects(ctx context.Context, req *gatewayv1.FilePath) (*gatewayv1.FoundProjects, error) {
	resp, err := p.filer.FindProjects(ctx, &filerv1.PathReq{Path: req.GetPath()})

	if err != nil {
		return nil, err
	}

	out := &gatewayv1.FoundProjects{}

	for _, pr := range resp.GetProjects() {
		out.Projects = append(out.Projects, &gatewayv1.FoundProject{Name: pr.GetName(), Path: pr.GetPath(), Kind: pr.GetKind()})
	}

	return out, nil
}

// --- AiAgent: ai PLANUJE operacje (JSON), gateway WYKONUJE je przez filer ---

type agentOp struct {
	Op      string `json:"op"`   // create_file | write | delete | rename | move | mkdir
	Path    string `json:"path"` // ścieżka (względna do dir lub absolutna)
	To      string `json:"to"`   // cel dla rename (nowa nazwa) / move (katalog)
	Content string `json:"content"`
}

type agentPlan struct {
	Ops     []agentOp `json:"ops"`
	Message string    `json:"message"`
	Open    string    `json:"open"`
}

// langInstr returns a "respond in <language>" directive for AI system prompts.
func langInstr(lang string) string {
	if lang == "en" {
		return " Respond strictly in English."
	}

	return " Odpowiadaj wyłącznie po polsku."
}

func (p *Proxy) AiAgent(ctx context.Context, req *gatewayv1.AiAgentRequest) (*gatewayv1.AiAgentResponse, error) {
	system := "Jesteś agentem zarządzającym plikami projektu. Na podstawie polecenia użytkownika " +
		"zwróć WYŁĄCZNIE JSON (bez markdown) w formacie: " +
		`{"ops":[{"op":"create_file","path":"...","content":"..."},{"op":"write","path":"...","content":"..."},` +
		`{"op":"delete","path":"..."},{"op":"rename","path":"stara","to":"nowa-nazwa-pliku"},` +
		`{"op":"move","path":"plik","to":"katalog"},{"op":"mkdir","path":"katalog"}],"open":"sciezka-do-otwarcia","message":"krótkie podsumowanie po polsku"}. ` +
		"Ścieżki względne odnoszą się do katalogu bazowego. Gdy tworzysz plik z klasą, wypełnij pole content kompletnym kodem. " +
		"Wykonuj tylko to, o co prosi użytkownik."

	resp, err := p.ai.Generate(ctx, &aiv1.GenerateRequest{
		System:    system + langInstr(req.GetLang()),
		Prompt:    "Katalog bazowy: " + req.GetDir() + "\nPolecenie: " + req.GetPrompt(),
		MaxTokens: 4096,
		Dir:       req.GetDir(), // cwd dla Claude headless
	})

	if err != nil {
		return nil, err
	}

	plan := parsePlan(resp.GetText())
	out := &gatewayv1.AiAgentResponse{Message: plan.Message}
	dir := req.GetDir()

	for _, op := range plan.Ops {
		abs := resolvePath(dir, op.Path)
		done := p.applyOp(ctx, dir, abs, op)

		if done == "" {
			continue
		}

		out.Ops = append(out.Ops, &gatewayv1.FileOp{Op: op.Op, Path: done})

		// domyślnie otwórz pierwszy utworzony/zapisany plik
		if out.OpenPath == "" && (op.Op == "create_file" || op.Op == "write") {
			out.OpenPath = done
		}
	}

	if plan.Open != "" {
		out.OpenPath = resolvePath(dir, plan.Open)
	}

	return out, nil
}

// applyOp wykonuje jedną operację przez filer; zwraca wynikową ścieżkę ("" = błąd).
func (p *Proxy) applyOp(ctx context.Context, dir, abs string, op agentOp) string {
	switch op.Op {
	case "create_file":
		r, err := p.filer.Create(ctx, &filerv1.CreateReq{
			Dir:     filepath.Dir(abs),
			File:    filepath.Base(abs),
			Name:    baseNameNoExt(abs),
			Content: op.Content,
		})

		if err != nil {
			return ""
		}

		return r.GetPath()

	case "write":
		r, err := p.filer.Save(ctx, &filerv1.SaveReq{Path: abs, Content: op.Content})

		if err != nil {
			return ""
		}

		return r.GetPath()

	case "delete":
		r, err := p.filer.Delete(ctx, &filerv1.PathReq{Path: abs})

		if err != nil {
			return ""
		}

		return r.GetPath()

	case "mkdir":
		r, err := p.filer.Mkdir(ctx, &filerv1.MkdirReq{Dir: filepath.Dir(abs), Name: filepath.Base(abs)})

		if err != nil {
			return ""
		}

		return r.GetPath()

	case "rename":
		r, err := p.filer.Rename(ctx, &filerv1.RenameReq{
			OldPath:  abs,
			FileBase: baseNameNoExt(op.To),
		})

		if err != nil {
			return ""
		}

		return r.GetPath()

	case "move":
		r, err := p.filer.Move(ctx, &filerv1.MoveReq{OldPath: abs, TargetDir: resolvePath(dir, op.To)})

		if err != nil {
			return ""
		}

		return r.GetPath()

	default:
		return ""
	}
}

func resolvePath(dir, p string) string {
	if p == "" || filepath.IsAbs(p) {
		return p
	}

	return filepath.Join(dir, p)
}

func baseNameNoExt(p string) string {
	b := filepath.Base(p)

	return strings.TrimSuffix(b, filepath.Ext(b))
}

// parsePlan wyłuskuje obiekt JSON z odpowiedzi LLM.
func parsePlan(text string) agentPlan {
	var plan agentPlan
	i := strings.Index(text, "{")
	j := strings.LastIndex(text, "}")

	if i >= 0 && j > i {
		_ = json.Unmarshal([]byte(text[i:j+1]), &plan)
	}

	return plan
}
