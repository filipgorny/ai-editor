// Package react to plugin frontendu React. Rozpoznaje aplikacje React i
// ekstrahuje komponenty (oraz to, co renderują) parsując TSX przez tree-sitter.
package react

import (
	"context"
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	sitter "github.com/smacker/go-tree-sitter"
	"github.com/smacker/go-tree-sitter/typescript/tsx"

	"github.com/filipgorny/ai-architect/plugins"
)

func init() {
	plugins.Register(&Plugin{})
}

// Plugin implementuje plugins.Plugin dla React.
type Plugin struct{}

func (p *Plugin) Framework() string {
	return "react"
}

// Detect uznaje katalog za React, gdy package.json zależy od "react" albo
// znajdą się pliki .tsx/.jsx.
func (p *Plugin) Detect(appDir string) bool {
	if packageDependsOnReact(filepath.Join(appDir, "package.json")) {
		return true
	}

	return hasJSXFiles(appDir)
}

// Extract parsuje pliki .tsx/.jsx i zbiera komponenty (równolegle na rdzeniach).
func (p *Plugin) Extract(ctx context.Context, appDir string) (*plugins.Entities, error) {
	files := collectJSXFiles(appDir)

	out := &plugins.Entities{}

	if len(files) == 0 {
		return out, nil
	}

	workers := runtime.NumCPU()

	if workers > len(files) {
		workers = len(files)
	}

	jobs := make(chan string)

	var mu sync.Mutex
	var wg sync.WaitGroup

	for i := 0; i < workers; i++ {
		wg.Add(1)

		go func() {
			defer wg.Done()

			parser := sitter.NewParser()
			parser.SetLanguage(tsx.GetLanguage())

			for path := range jobs {
				src, err := os.ReadFile(path)

				if err != nil {
					continue
				}

				comps := parseComponents(ctx, parser, src, relPath(appDir, path))

				mu.Lock()
				out.Elements = append(out.Elements, comps...)
				mu.Unlock()
			}
		}()
	}

	for _, f := range files {
		select {
		case <-ctx.Done():
			close(jobs)
			wg.Wait()

			return out, ctx.Err()

		case jobs <- f:
		}
	}

	close(jobs)
	wg.Wait()

	return out, nil
}

func parseComponents(ctx context.Context, parser *sitter.Parser, src []byte, file string) []plugins.Element {
	tree, err := parser.ParseCtx(ctx, nil, src)

	if err != nil {
		return nil
	}

	defer tree.Close()

	var comps []plugins.Element

	// function_declaration PascalCase z JSX
	for _, fn := range collectByType(tree.RootNode(), "function_declaration") {
		name := fieldText(fn, "name", src)

		if isComponentName(name) && containsJSX(fn) {
			comps = append(comps, component(name, file, rendersOf(fn, src, name)))
		}
	}

	// const Foo = (...) => <jsx> albo function expression
	for _, decl := range collectByType(tree.RootNode(), "variable_declarator") {
		name := fieldText(decl, "name", src)

		if !isComponentName(name) {
			continue
		}

		value := decl.ChildByFieldName("value")

		if value == nil {
			continue
		}

		if (value.Type() == "arrow_function" || value.Type() == "function") && containsJSX(value) {
			comps = append(comps, component(name, file, rendersOf(value, src, name)))
		}
	}

	return comps
}

func component(name, file string, renders []string) plugins.Element {
	el := plugins.Element{Kind: "component", Name: name, File: file}

	for _, ref := range renders {
		el.Links = append(el.Links, plugins.Link{Target: ref, Label: "renders"})
	}

	return el
}

// rendersOf zwraca nazwy renderowanych komponentów (PascalCase tagi JSX).
func rendersOf(node *sitter.Node, src []byte, self string) []string {
	seen := map[string]bool{}
	var out []string

	add := func(n *sitter.Node) {
		nameNode := n.ChildByFieldName("name")

		if nameNode == nil {
			return
		}

		name := nameNode.Content(src)

		if !isComponentName(name) || name == self || seen[name] {
			return
		}

		seen[name] = true
		out = append(out, name)
	}

	for _, el := range collectByType(node, "jsx_opening_element") {
		add(el)
	}

	for _, el := range collectByType(node, "jsx_self_closing_element") {
		add(el)
	}

	return out
}

func containsJSX(node *sitter.Node) bool {
	if len(collectByType(node, "jsx_element")) > 0 {
		return true
	}

	return len(collectByType(node, "jsx_self_closing_element")) > 0
}

func isComponentName(name string) bool {
	if name == "" {
		return false
	}

	first := name[0]

	return first >= 'A' && first <= 'Z'
}

// --- pomocnicze: tree-sitter ---

func collectByType(root *sitter.Node, typ string) []*sitter.Node {
	var found []*sitter.Node

	var walk func(n *sitter.Node)

	walk = func(n *sitter.Node) {
		if n == nil {
			return
		}

		if n.Type() == typ {
			found = append(found, n)
		}

		for i := 0; i < int(n.NamedChildCount()); i++ {
			walk(n.NamedChild(i))
		}
	}

	walk(root)

	return found
}

func fieldText(n *sitter.Node, field string, src []byte) string {
	child := n.ChildByFieldName(field)

	if child == nil {
		return ""
	}

	return child.Content(src)
}

// --- pomocnicze: pliki ---

func isJSXSource(name string) bool {
	if strings.HasSuffix(name, ".d.ts") {
		return false
	}

	if strings.HasSuffix(name, ".spec.tsx") || strings.HasSuffix(name, ".test.tsx") {
		return false
	}

	return strings.HasSuffix(name, ".tsx") || strings.HasSuffix(name, ".jsx")
}

func collectJSXFiles(appDir string) []string {
	var files []string

	_ = filepath.WalkDir(appDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}

		if d.IsDir() {
			if path != appDir && skipDir(d.Name()) {
				return filepath.SkipDir
			}

			return nil
		}

		if isJSXSource(d.Name()) {
			files = append(files, path)
		}

		return nil
	})

	return files
}

func hasJSXFiles(appDir string) bool {
	found := false

	_ = filepath.WalkDir(appDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}

		if d.IsDir() {
			if path != appDir && skipDir(d.Name()) {
				return filepath.SkipDir
			}

			return nil
		}

		if isJSXSource(d.Name()) {
			found = true

			return filepath.SkipAll
		}

		return nil
	})

	return found
}

func skipDir(name string) bool {
	switch name {
	case "node_modules", "dist", "build", "out", "coverage", "vendor", ".next":
		return true
	}

	return strings.HasPrefix(name, ".")
}

func relPath(root, path string) string {
	rel, err := filepath.Rel(root, path)

	if err != nil {
		return path
	}

	return rel
}

func packageDependsOnReact(path string) bool {
	data, err := os.ReadFile(path)

	if err != nil {
		return false
	}

	var pkg struct {
		Dependencies    map[string]string `json:"dependencies"`
		DevDependencies map[string]string `json:"devDependencies"`
	}

	if err := json.Unmarshal(data, &pkg); err != nil {
		return false
	}

	if _, ok := pkg.Dependencies["react"]; ok {
		return true
	}

	_, ok := pkg.DevDependencies["react"]

	return ok
}
