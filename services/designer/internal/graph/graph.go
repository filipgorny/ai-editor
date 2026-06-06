// Package graph buduje grafy (serwisy monorepo / wnętrze aplikacji) z bytów GORM.
// Wszystko układa się w drzewko folderów (żółte węzły) wg ścieżek.
package graph

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gorm.io/gorm"

	gatewayv1 "github.com/filipgorny/ai-architect/proto/gateway/v1"
	"github.com/filipgorny/ai-architect/services/designer/internal/store"
)

// Builder czyta byty przez GORM i składa z nich grafy.
type Builder struct {
	db *gorm.DB
}

func NewBuilder(db *gorm.DB) *Builder {
	return &Builder{db: db}
}

// folderTree dorzuca do grafu żółte węzły-foldery (per katalog) i krawędzie
// "contains", tworząc drzewko wg ścieżek.
type folderTree struct {
	g       *gatewayv1.Graph
	ids     map[string]string // dirpath -> nodeID
	baseDir string            // absolutna baza (do pola File folderów)
}

func newFolderTree(g *gatewayv1.Graph, rootName, baseDir string) *folderTree {
	const rootID = "folder:."

	g.Nodes = append(g.Nodes, &gatewayv1.Node{Id: rootID, Kind: "folder", Name: rootName, File: baseDir})

	return &folderTree{g: g, ids: map[string]string{".": rootID}, baseDir: baseDir}
}

func (t *folderTree) ensure(dir string) string {
	if id, ok := t.ids[dir]; ok {
		return id
	}

	parent := t.ensure(filepath.Dir(dir))
	id := "folder:" + dir

	t.g.Nodes = append(t.g.Nodes, &gatewayv1.Node{
		Id: id, Kind: "folder", Name: filepath.Base(dir), File: filepath.Join(t.baseDir, dir),
	})

	t.ids[dir] = id
	t.g.Edges = append(t.g.Edges, &gatewayv1.Edge{From: parent, To: id, Label: "contains"})

	return id
}

// contains podpina węzeł childID pod folder katalogu dir.
func (t *folderTree) contains(dir, childID string) {
	t.g.Edges = append(t.g.Edges, &gatewayv1.Edge{From: t.ensure(dir), To: childID, Label: "contains"})
}

// BuildApps zwraca graf serwisów monorepo: drzewko folderów (apps/packages/tools)
// z aplikacjami jako liśćmi.
func (b *Builder) BuildApps(ctx context.Context, projectID int64, folder string) (*gatewayv1.Graph, error) {
	var apps []store.App

	if err := b.db.WithContext(ctx).Where("project_id = ?", projectID).Order("name").Find(&apps).Error; err != nil {
		return nil, err
	}

	g := &gatewayv1.Graph{ProjectId: projectID, Folder: folder}
	tree := newFolderTree(g, filepath.Base(folder), folder)

	for _, a := range apps {
		nodeID := fmt.Sprintf("app:%d", a.ID)

		g.Nodes = append(g.Nodes, &gatewayv1.Node{
			Id:        nodeID,
			Kind:      "app",
			Name:      a.Name,
			File:      a.Path,
			App:       a.Name,
			AppId:     a.ID,
			Framework: a.Framework,
		})

		tree.contains(filepath.Dir(a.Path), nodeID)
	}

	// Also surface the project's real top-level directories — even those without an
	// app — so a folder added to the root (by the user or AI) appears on the graph.
	addTopDirs(tree, folder)

	return g, nil
}

// BuildSingleApp zwraca graf projektu nie-monorepo: jego pierwszym (i jedynym)
// elementem jest węzeł aplikacji (app). Drill-down na ten węzeł pokazuje wnętrze
// (BuildAppGraph). Gdy projekt nie ma jeszcze aplikacji, zwraca pusty graf.
func (b *Builder) BuildSingleApp(ctx context.Context, projectID int64, folder string) (*gatewayv1.Graph, error) {
	g := &gatewayv1.Graph{ProjectId: projectID, Folder: folder}

	var app store.App

	err := b.db.WithContext(ctx).Where("project_id = ?", projectID).Order("id").First(&app).Error

	if errors.Is(err, gorm.ErrRecordNotFound) {
		return g, nil
	}

	if err != nil {
		return nil, err
	}

	g.Nodes = append(g.Nodes, &gatewayv1.Node{
		Id:        fmt.Sprintf("app:%d", app.ID),
		Kind:      "app",
		Name:      app.Name,
		File:      app.Path,
		App:       app.Name,
		AppId:     app.ID,
		Framework: app.Framework,
	})

	return g, nil
}

// addTopDirs adds the immediate subdirectories of root as folder nodes (skipping
// build/VCS junk), so the monorepo graph reflects the actual disk layout.
func addTopDirs(t *folderTree, root string) {
	entries, err := os.ReadDir(root)

	if err != nil {
		return
	}

	for _, e := range entries {
		if e.IsDir() && !ignoredDir(e.Name()) {
			t.ensure(e.Name())
		}
	}
}

func ignoredDir(name string) bool {
	switch name {
	case "node_modules", ".git", "dist", "build", "out", ".next", "vendor", "target", ".cache", ".idea", ".vscode":
		return true
	}

	return strings.HasPrefix(name, "bazel-")
}

// BuildAppGraph zwraca wewnętrzny graf aplikacji: WSZYSTKIE byty ładowane jednym
// zapytaniem, w drzewku folderów wg ścieżek plików, z funkcjami i frameworkiem.
func (b *Builder) BuildAppGraph(ctx context.Context, appID int64) (*gatewayv1.Graph, error) {
	var elements []store.Element

	if err := b.db.WithContext(ctx).Where("app_id = ?", appID).Order("id").Find(&elements).Error; err != nil {
		return nil, err
	}

	var app store.App
	b.db.WithContext(ctx).First(&app, appID)

	var proj store.Project
	b.db.WithContext(ctx).First(&proj, app.ProjectID)

	appDir := filepath.Join(proj.Folder, app.Path)

	g := &gatewayv1.Graph{ProjectId: app.ProjectID, Folder: proj.Folder}
	tree := newFolderTree(g, app.Name, appDir)

	index := map[string]string{}

	for _, e := range elements {
		nodeID := e.Kind + ":" + e.Name

		g.Nodes = append(g.Nodes, &gatewayv1.Node{
			Id: nodeID, Kind: e.Kind, Name: e.Name, File: e.File,
			Route: e.Route, Functions: e.Functions, Framework: e.Framework,
			AbsFile: filepath.Join(appDir, e.File),
		})

		if _, exists := index[e.Name]; !exists {
			index[e.Name] = nodeID
		}

		tree.contains(filepath.Dir(e.File), nodeID)
	}

	g.Edges = append(g.Edges, edgesFrom(elements, index)...)

	return g, nil
}

func edgesFrom(elements []store.Element, index map[string]string) []*gatewayv1.Edge {
	var edges []*gatewayv1.Edge
	seen := map[string]bool{}

	for _, e := range elements {
		from := e.Kind + ":" + e.Name

		for _, l := range e.Links {
			toID, ok := index[l.Target]

			if !ok || toID == from {
				continue
			}

			key := from + "->" + toID + ":" + l.Label

			if seen[key] {
				continue
			}

			seen[key] = true
			edges = append(edges, &gatewayv1.Edge{From: from, To: toID, Label: l.Label})
		}
	}

	return edges
}
