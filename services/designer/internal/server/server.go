// Package server implementuje serwis designer: persystuje wyniki ze scannera
// (jedyny serwis z dostępem do bazy) i serwuje grafy dla aplikacji Electron.
package server

import (
	"context"
	"fmt"
	"io"

	"github.com/filipgorny/ai-architect/plugins"
	gatewayv1 "github.com/filipgorny/ai-architect/proto/gateway/v1"
	scannerv1 "github.com/filipgorny/ai-architect/proto/scanner/v1"
	"github.com/filipgorny/ai-architect/services/designer/internal/graph"
	"github.com/filipgorny/ai-architect/services/designer/internal/store"
)

// Server konsumuje strumień scannera, zapisuje do bazy (store) i buduje grafy.
type Server struct {
	gatewayv1.UnimplementedGatewayServer

	scanner scannerv1.ScannerClient
	store   *store.Store
	graph   *graph.Builder
}

func New(scanner scannerv1.ScannerClient, st *store.Store, gb *graph.Builder) *Server {
	return &Server{scanner: scanner, store: st, graph: gb}
}

// SaveGraphState persists per-scene graph UI state (viewport/positions) in Postgres.
func (s *Server) SaveGraphState(ctx context.Context, req *gatewayv1.GraphStateRequest) (*gatewayv1.FileResult, error) {
	if err := s.store.SaveGraphState(ctx, req.GetKey(), req.GetData()); err != nil {
		return nil, err
	}

	return &gatewayv1.FileResult{Path: req.GetKey(), Ok: true}, nil
}

// GetGraphState loads the saved graph UI state for a scene key.
func (s *Server) GetGraphState(ctx context.Context, req *gatewayv1.GraphStateKey) (*gatewayv1.GraphStateResponse, error) {
	data, err := s.store.GetGraphState(ctx, req.GetKey())

	if err != nil {
		return nil, err
	}

	return &gatewayv1.GraphStateResponse{Data: data}, nil
}

// Scan: skan wierzchni — zapisuje projekt i jego aplikacje (serwisy).
func (s *Server) Scan(req *gatewayv1.ScanRequest, out gatewayv1.Gateway_ScanServer) error {
	ctx := out.Context()

	in, err := s.scanner.Scan(ctx, &scannerv1.ScanRequest{Path: req.GetPath()})

	if err != nil {
		return err
	}

	var projectID int64

	for {
		ev, err := in.Recv()

		if err == io.EOF {
			return nil
		}

		if err != nil {
			return err
		}

		p := &gatewayv1.Progress{}

		switch {
		case ev.GetProject() != nil:
			pr := ev.GetProject()

			id, e := s.store.UpsertProject(ctx, pr.GetFolder(), pr.GetGitPath(), pr.GetKind())

			if e != nil {
				return e
			}

			projectID = id
			p.Message = fmt.Sprintf("Projekt #%d (%s)", id, pr.GetKind())

		case ev.GetApp() != nil:
			a := ev.GetApp()

			if _, e := s.store.UpsertApp(ctx, projectID, a.GetName(), a.GetPath(), a.GetFramework(), a.GetHasPlugin()); e != nil {
				return e
			}

			p.CurrentFile = a.GetName()
			p.Message = "serwis: " + a.GetName()

		case ev.GetLog() != nil:
			p.Message = ev.GetLog().GetMessage()

		case ev.GetDone() != nil:
			p.Done = true
		}

		p.ProjectId = projectID

		if err := out.Send(p); err != nil {
			return err
		}
	}
}

// ScanApp: głęboki skan serwisu — czyści i zapisuje WSZYSTKIE encje oraz opisy plików.
func (s *Server) ScanApp(req *gatewayv1.ScanAppRequest, out gatewayv1.Gateway_ScanAppServer) error {
	ctx := out.Context()
	appID := req.GetAppId()

	dir, err := s.store.AppDir(ctx, appID)

	if err != nil {
		return err
	}

	if err := s.store.ClearAppEntities(ctx, appID); err != nil {
		return err
	}

	in, err := s.scanner.ScanApp(ctx, &scannerv1.ScanAppRequest{Path: dir})

	if err != nil {
		return err
	}

	var files, entities int32

	for {
		ev, err := in.Recv()

		if err == io.EOF {
			return nil
		}

		if err != nil {
			return err
		}

		p := &gatewayv1.Progress{}

		switch {
		case ev.GetElement() != nil:
			el := ev.GetElement()

			links := make([]plugins.Link, 0, len(el.GetLinks()))

			for _, l := range el.GetLinks() {
				links = append(links, plugins.Link{Target: l.GetTarget(), Label: l.GetLabel()})
			}

			if e := s.store.InsertElement(ctx, appID, plugins.Element{
				Framework: el.GetFramework(), Kind: el.GetKind(), Name: el.GetName(), File: el.GetFile(),
				Route: el.GetRoute(), Functions: el.GetFunctions(), Links: links,
			}); e != nil {
				return e
			}

			entities++
			p.CurrentFile = el.GetFile()
			p.Message = el.GetKind() + " " + el.GetName()

		case ev.GetFile() != nil:
			f := ev.GetFile()

			if e := s.store.InsertFile(ctx, appID, f.GetPath(), f.GetDescription()); e != nil {
				return e
			}

			files++
			p.CurrentFile = f.GetPath()
			p.Message = f.GetPath()

		case ev.GetLog() != nil:
			p.Message = ev.GetLog().GetMessage()

		case ev.GetDone() != nil:
			p.Done = true
		}

		p.FilesDone = files
		p.EntitiesDone = entities

		if err := out.Send(p); err != nil {
			return err
		}
	}
}

func (s *Server) GetGraph(ctx context.Context, req *gatewayv1.GraphRequest) (*gatewayv1.Graph, error) {
	pr, err := s.store.ProjectByID(ctx, req.GetProjectId())

	if err != nil {
		return nil, fmt.Errorf("brak przeskanowanych projektów: %w", err)
	}

	if pr.Kind == "monorepo" {
		return s.graph.BuildApps(ctx, pr.ID, pr.Folder)
	}

	// Nie-monorepo: pierwszym elementem diagramu jest węzeł aplikacji (app),
	// a nie drzewo folderów — drill-down pokazuje jego wnętrze.
	return s.graph.BuildSingleApp(ctx, pr.ID, pr.Folder)
}

func (s *Server) GetAppGraph(ctx context.Context, req *gatewayv1.AppGraphRequest) (*gatewayv1.Graph, error) {
	return s.graph.BuildAppGraph(ctx, req.GetAppId())
}

func (s *Server) ListProjects(ctx context.Context, _ *gatewayv1.Empty) (*gatewayv1.Projects, error) {
	projects, err := s.store.ListProjects(ctx)

	if err != nil {
		return nil, err
	}

	out := &gatewayv1.Projects{}

	for _, p := range projects {
		out.Projects = append(out.Projects, &gatewayv1.Project{
			Id: p.ID, Folder: p.Folder, GitPath: p.GitPath, Kind: p.Kind,
		})
	}

	return out, nil
}
