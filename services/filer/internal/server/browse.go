package server

import (
	"context"
	"os"
	"path/filepath"
	"sort"

	filerv1 "github.com/filipgorny/ai-architect/proto/filer/v1"
)

// Home zwraca katalog domowy użytkownika (punkt startowy przeglądania).
func (s *Server) Home(_ context.Context, _ *filerv1.Empty) (*filerv1.Result, error) {
	home, err := os.UserHomeDir()

	if err != nil || home == "" {
		home = "/"
	}

	return &filerv1.Result{Path: home, Ok: true}, nil
}

// ListDir zwraca podkatalogi (i pliki) wskazanej ścieżki — do przeglądania dysku.
func (s *Server) ListDir(_ context.Context, req *filerv1.PathReq) (*filerv1.DirListing, error) {
	path := req.GetPath()

	if path == "" {
		if home, err := os.UserHomeDir(); err == nil {
			path = home
		} else {
			path = "/"
		}
	}

	entries, err := os.ReadDir(path)

	if err != nil {
		return nil, err
	}

	out := &filerv1.DirListing{Path: path, Parent: filepath.Dir(path)}

	for _, e := range entries {
		name := e.Name()

		// pomiń ukryte oraz ciężkie katalogi
		if name == "node_modules" || name == ".git" || (len(name) > 0 && name[0] == '.') {
			continue
		}

		out.Entries = append(out.Entries, &filerv1.Entry{
			Name: name,
			Path: filepath.Join(path, name),
			Dir:  e.IsDir(),
		})
	}

	sort.Slice(out.Entries, func(i, j int) bool {
		if out.Entries[i].Dir != out.Entries[j].Dir {
			return out.Entries[i].Dir // katalogi na górze
		}

		return out.Entries[i].Name < out.Entries[j].Name
	})

	return out, nil
}

// FindProjects szuka (płytko) projektów pod ścieżką — po markerach repo/package.
func (s *Server) FindProjects(_ context.Context, req *filerv1.PathReq) (*filerv1.ProjectList, error) {
	root := req.GetPath()

	if root == "" {
		if home, err := os.UserHomeDir(); err == nil {
			root = home
		} else {
			root = "/"
		}
	}

	out := &filerv1.ProjectList{}

	walk := func(dir string) {
		if kind := projectKind(dir); kind != "" {
			out.Projects = append(out.Projects, &filerv1.ProjectFound{
				Name: filepath.Base(dir),
				Path: dir,
				Kind: kind,
			})
		}
	}

	walk(root)

	// jeden poziom w głąb (szybko, bez rekurencji w cały dysk)
	if entries, err := os.ReadDir(root); err == nil {
		for _, e := range entries {
			if !e.IsDir() || e.Name() == "node_modules" || e.Name()[0] == '.' {
				continue
			}

			walk(filepath.Join(root, e.Name()))
		}
	}

	return out, nil
}

// projectKind rozpoznaje, czy katalog wygląda na projekt (i jaki).
func projectKind(dir string) string {
	if exists(filepath.Join(dir, ".git")) {
		return "git"
	}

	if exists(filepath.Join(dir, "package.json")) || exists(filepath.Join(dir, "pnpm-workspace.yaml")) {
		return "node"
	}

	if exists(filepath.Join(dir, "go.mod")) {
		return "go"
	}

	return ""
}

func exists(p string) bool {
	_, err := os.Stat(p)

	return err == nil
}
