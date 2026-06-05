// Package nestjs to plugin frameworka NestJS. Rozpoznaje aplikacje NestJS i
// ekstrahuje encje (Module/Controller/Service) parsując TypeScript przez tree-sitter.
package nestjs

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
	"github.com/smacker/go-tree-sitter/typescript/typescript"

	"github.com/filipgorny/ai-architect/plugins"
)

func init() {
	plugins.Register(&Plugin{})
}

// Plugin implementuje plugins.Plugin dla NestJS.
type Plugin struct{}

func (p *Plugin) Framework() string {
	return "nestjs"
}

// Detect uznaje katalog za NestJS, gdy package.json zależy od @nestjs/core,
// istnieje nest-cli.json albo znajdzie się jakikolwiek plik *.module.ts.
func (p *Plugin) Detect(appDir string) bool {
	if exists(filepath.Join(appDir, "nest-cli.json")) {
		return true
	}

	if packageDependsOnNest(filepath.Join(appDir, "package.json")) {
		return true
	}

	return hasModuleFile(appDir)
}

// Extract parsuje wszystkie pliki .ts aplikacji i zbiera encje. Parsowanie
// (CPU-bound) jest zrównoleglone na wszystkie rdzenie — każdy worker ma własny
// parser (tree-sitter nie jest thread-safe), wyniki scalane pod mutexem.
func (p *Plugin) Extract(ctx context.Context, appDir string) (*plugins.Entities, error) {
	files := collectTSFiles(appDir)

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
			parser.SetLanguage(typescript.GetLanguage())

			for path := range jobs {
				src, err := os.ReadFile(path)

				if err != nil {
					continue
				}

				local := &plugins.Entities{}
				parseFile(ctx, parser, src, relPath(appDir, path), local)

				mu.Lock()
				out.Elements = append(out.Elements, local.Elements...)
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

// collectTSFiles zbiera ścieżki plików .ts (pomijając zależności/build/testy).
func collectTSFiles(appDir string) []string {
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

		if isTSSource(d.Name()) {
			files = append(files, path)
		}

		return nil
	})

	return files
}

func parseFile(ctx context.Context, parser *sitter.Parser, src []byte, file string, out *plugins.Entities) {
	tree, err := parser.ParseCtx(ctx, nil, src)

	if err != nil {
		return
	}

	defer tree.Close()

	for _, class := range collectByType(tree.RootNode(), "class_declaration") {
		name := fieldText(class, "name", src)

		if name == "" {
			continue
		}

		out.Elements = append(out.Elements, classElement(class, name, file, src))
	}

	// Samodzielne, niezależne funkcje (poza klasami) — osobne byty kind=function.
	for _, fn := range collectByType(tree.RootNode(), "function_declaration") {
		if !isTopLevel(fn) {
			continue
		}

		if name := fieldText(fn, "name", src); name != "" {
			out.Elements = append(out.Elements, plugins.Element{Kind: "function", Name: name, File: file})
		}
	}
}

// classElement buduje Element z deklaracji klasy: kind wg dekoratora
// (@Module/@Controller/@Injectable), albo "class" gdy niedekorowana.
func classElement(class *sitter.Node, name, file string, src []byte) plugins.Element {
	methods, deps := classMembers(class, src)

	el := plugins.Element{Kind: "class", Name: name, File: file, Functions: methods}

	for _, dep := range deps {
		el.Links = append(el.Links, plugins.Link{Target: dep, Label: "injects"})
	}

	for _, dec := range classDecorators(class) {
		switch decoratorName(dec, src) {
		case "Module":
			el.Kind = "module"
			el.Functions = nil
			el.Links = nil

			for _, ref := range moduleArray(dec, "imports", src) {
				el.Links = append(el.Links, plugins.Link{Target: ref, Label: "import"})
			}

			for _, ref := range moduleArray(dec, "controllers", src) {
				el.Links = append(el.Links, plugins.Link{Target: ref, Label: "controller"})
			}

			for _, ref := range moduleArray(dec, "providers", src) {
				el.Links = append(el.Links, plugins.Link{Target: ref, Label: "provider"})
			}

		case "Controller":
			el.Kind = "controller"
			el.Route = firstStringArg(dec, src)

		case "Injectable":
			el.Kind = "service"
		}
	}

	return el
}

// isTopLevel sprawdza, czy funkcja jest na poziomie modułu (nie zagnieżdżona).
func isTopLevel(n *sitter.Node) bool {
	p := n.Parent()

	if p == nil {
		return false
	}

	if p.Type() == "program" {
		return true
	}

	if p.Type() == "export_statement" {
		gp := p.Parent()

		return gp != nil && gp.Type() == "program"
	}

	return false
}

// classDecorators zwraca dekoratory przypięte do klasy (z export_statement lub
// bezpośrednio z class_declaration).
func classDecorators(class *sitter.Node) []*sitter.Node {
	var nodes []*sitter.Node

	owners := []*sitter.Node{class}

	if parent := class.Parent(); parent != nil && parent.Type() == "export_statement" {
		owners = append(owners, parent)
	}

	for _, owner := range owners {
		for i := 0; i < int(owner.NamedChildCount()); i++ {
			child := owner.NamedChild(i)

			if child.Type() == "decorator" {
				nodes = append(nodes, child)
			}
		}
	}

	return nodes
}

// classMembers zwraca nazwy metod (bez konstruktora) oraz typy wstrzykiwane
// w konstruktorze (zależności).
func classMembers(class *sitter.Node, src []byte) (methods, deps []string) {
	body := class.ChildByFieldName("body")

	if body == nil {
		return nil, nil
	}

	for _, m := range collectByType(body, "method_definition") {
		name := fieldText(m, "name", src)

		if name == "constructor" {
			deps = append(deps, constructorTypes(m, src)...)

			continue
		}

		if name != "" {
			methods = append(methods, name)
		}
	}

	return methods, deps
}

func constructorTypes(method *sitter.Node, src []byte) []string {
	var types []string

	params := method.ChildByFieldName("parameters")

	if params == nil {
		return nil
	}

	for _, p := range collectByType(params, "required_parameter") {
		ann := p.ChildByFieldName("type")

		if ann == nil {
			continue
		}

		for _, t := range collectByType(ann, "type_identifier") {
			types = append(types, t.Content(src))
		}
	}

	return types
}

func decoratorName(dec *sitter.Node, src []byte) string {
	call := firstChildOfType(dec, "call_expression")

	if call != nil {
		if fn := call.ChildByFieldName("function"); fn != nil {
			return fn.Content(src)
		}
	}

	if id := firstChildOfType(dec, "identifier"); id != nil {
		return id.Content(src)
	}

	return ""
}

func firstStringArg(dec *sitter.Node, src []byte) string {
	for _, s := range collectByType(dec, "string_fragment") {
		return s.Content(src)
	}

	return ""
}

func moduleArray(dec *sitter.Node, key string, src []byte) []string {
	objects := collectByType(dec, "object")

	if len(objects) == 0 {
		return nil
	}

	obj := objects[0]

	for _, pair := range collectByType(obj, "pair") {
		k := pair.ChildByFieldName("key")

		if k == nil || k.Content(src) != key {
			continue
		}

		value := pair.ChildByFieldName("value")

		if value == nil {
			return nil
		}

		var ids []string

		for _, id := range collectByType(value, "identifier") {
			ids = append(ids, id.Content(src))
		}

		return ids
	}

	return nil
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

func firstChildOfType(root *sitter.Node, typ string) *sitter.Node {
	for i := 0; i < int(root.NamedChildCount()); i++ {
		child := root.NamedChild(i)

		if child.Type() == typ {
			return child
		}
	}

	return nil
}

func fieldText(n *sitter.Node, field string, src []byte) string {
	child := n.ChildByFieldName(field)

	if child == nil {
		return ""
	}

	return child.Content(src)
}

// --- pomocnicze: pliki ---

func isTSSource(name string) bool {
	if !strings.HasSuffix(name, ".ts") || strings.HasSuffix(name, ".d.ts") {
		return false
	}

	return !strings.HasSuffix(name, ".spec.ts") && !strings.HasSuffix(name, ".test.ts")
}

func skipDir(name string) bool {
	switch name {
	case "node_modules", "dist", "build", "out", "coverage", "vendor":
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

func exists(path string) bool {
	_, err := os.Stat(path)

	return err == nil
}

func hasModuleFile(root string) bool {
	found := false

	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}

		if d.IsDir() {
			if path != root && skipDir(d.Name()) {
				return filepath.SkipDir
			}

			return nil
		}

		if strings.HasSuffix(d.Name(), ".module.ts") {
			found = true

			return filepath.SkipAll
		}

		return nil
	})

	return found
}

func packageDependsOnNest(path string) bool {
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

	if _, ok := pkg.Dependencies["@nestjs/core"]; ok {
		return true
	}

	_, ok := pkg.DevDependencies["@nestjs/core"]

	return ok
}
