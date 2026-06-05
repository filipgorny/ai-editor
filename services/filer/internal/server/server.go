// Package server implementuje serwis filer — JEDYNE miejsce backendu dotykające
// systemu plików. Gateway pośredniczy; Electron nigdy nie rusza fs bezpośrednio.
package server

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	filerv1 "github.com/filipgorny/ai-architect/proto/filer/v1"
)

type Server struct {
	filerv1.UnimplementedFilerServer
}

func New() *Server {
	return &Server{}
}

func (s *Server) Read(_ context.Context, req *filerv1.PathReq) (*filerv1.Content, error) {
	data, err := os.ReadFile(req.GetPath())

	if err != nil {
		return nil, err
	}

	return &filerv1.Content{Content: string(data)}, nil
}

func (s *Server) Save(_ context.Context, req *filerv1.SaveReq) (*filerv1.Result, error) {
	if err := os.WriteFile(req.GetPath(), []byte(req.GetContent()), 0o644); err != nil {
		return nil, err
	}

	return &filerv1.Result{Path: req.GetPath(), Ok: true}, nil
}

// Create tworzy plik (gdy nie istnieje). Bez treści — wstawia szkielet klasy.
func (s *Server) Create(_ context.Context, req *filerv1.CreateReq) (*filerv1.Result, error) {
	path := filepath.Join(req.GetDir(), req.GetFile())

	if _, err := os.Stat(path); os.IsNotExist(err) {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return nil, err
		}

		body := req.GetContent()

		if body == "" {
			body = skeleton(req.GetFile(), req.GetName())
		}

		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			return nil, err
		}
	}

	return &filerv1.Result{Path: path, Ok: true}, nil
}

func (s *Server) Mkdir(_ context.Context, req *filerv1.MkdirReq) (*filerv1.Result, error) {
	path := filepath.Join(req.GetDir(), req.GetName())

	if err := os.MkdirAll(path, 0o755); err != nil {
		return nil, err
	}

	return &filerv1.Result{Path: path, Ok: true}, nil
}

// Rename zmienia nazwę klasy w treści (po granicy słowa) i nazwę pliku.
func (s *Server) Rename(_ context.Context, req *filerv1.RenameReq) (*filerv1.Result, error) {
	old := req.GetOldPath()
	ext := filepath.Ext(old)
	newPath := filepath.Join(filepath.Dir(old), req.GetFileBase()+ext)

	data, err := os.ReadFile(old)

	if err != nil {
		return nil, err
	}

	content := string(data)

	if req.GetOldName() != "" && req.GetClassName() != "" && req.GetOldName() != req.GetClassName() {
		re := regexp.MustCompile(`\b` + regexp.QuoteMeta(req.GetOldName()) + `\b`)
		content = re.ReplaceAllString(content, req.GetClassName())
	}

	if newPath != old {
		if err := os.WriteFile(newPath, []byte(content), 0o644); err != nil {
			return nil, err
		}

		_ = os.Remove(old)
	} else if err := os.WriteFile(old, []byte(content), 0o644); err != nil {
		return nil, err
	}

	return &filerv1.Result{Path: newPath, Ok: true}, nil
}

// Move przenosi plik do katalogu docelowego.
func (s *Server) Move(_ context.Context, req *filerv1.MoveReq) (*filerv1.Result, error) {
	old := req.GetOldPath()
	newPath := filepath.Join(req.GetTargetDir(), filepath.Base(old))

	if newPath == old {
		return &filerv1.Result{Path: old, Ok: true}, nil
	}

	if err := os.MkdirAll(req.GetTargetDir(), 0o755); err != nil {
		return nil, err
	}

	if err := os.Rename(old, newPath); err != nil {
		// fallback: kopiuj + usuń (gdy inny system plików)
		data, rerr := os.ReadFile(old)

		if rerr != nil {
			return nil, rerr
		}

		if werr := os.WriteFile(newPath, data, 0o644); werr != nil {
			return nil, werr
		}

		_ = os.Remove(old)
	}

	return &filerv1.Result{Path: newPath, Ok: true}, nil
}

func (s *Server) Delete(_ context.Context, req *filerv1.PathReq) (*filerv1.Result, error) {
	if err := os.RemoveAll(req.GetPath()); err != nil {
		return nil, err
	}

	return &filerv1.Result{Path: req.GetPath(), Ok: true}, nil
}

// Resolve rozwiązuje względny import (./foo) do istniejącego pliku.
func (s *Server) Resolve(_ context.Context, req *filerv1.ResolveReq) (*filerv1.Result, error) {
	spec := req.GetSpec()

	if !strings.HasPrefix(spec, ".") {
		return &filerv1.Result{Path: "", Ok: false}, nil
	}

	base := filepath.Join(filepath.Dir(req.GetFrom()), spec)
	exts := []string{".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".go", ".py", ".json"}
	candidates := []string{base}

	for _, e := range exts {
		candidates = append(candidates, base+e)
	}

	for _, e := range exts {
		candidates = append(candidates, filepath.Join(base, "index"+e))
	}

	for _, c := range candidates {
		if info, err := os.Stat(c); err == nil && !info.IsDir() {
			return &filerv1.Result{Path: c, Ok: true}, nil
		}
	}

	return &filerv1.Result{Path: "", Ok: false}, nil
}

// skeleton zwraca szkielet pliku wg rozszerzenia (pusta klasa o nazwie name).
func skeleton(file, name string) string {
	switch filepath.Ext(file) {
	case ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs":
		return "export class " + name + " {\n}\n"
	case ".go":
		return "package main\n\ntype " + name + " struct {\n}\n"
	case ".py":
		return "class " + name + ":\n    pass\n"
	default:
		return ""
	}
}
