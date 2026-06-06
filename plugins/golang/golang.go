// Package golang to plugin backendu Go. Rozpoznaje serwisy/aplikacje napisane w
// Go i ekstrahuje ich strukturę (typy: struct/interface jako "class", metody i
// funkcje najwyższego poziomu) parsując pliki .go standardowym go/parser.
package golang

import (
	"context"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/filipgorny/ai-architect/plugins"
)

func init() {
	plugins.Register(&Plugin{})
}

// Plugin implementuje plugins.Plugin dla Go.
type Plugin struct{}

func (p *Plugin) Framework() string {
	return "go"
}

// Detect uznaje katalog za Go, gdy zawiera go.mod albo jakikolwiek plik .go.
func (p *Plugin) Detect(appDir string) bool {
	if exists(filepath.Join(appDir, "go.mod")) {
		return true
	}

	return hasGoFiles(appDir)
}

// Extract parsuje pliki .go i zbiera typy (struct/interface) wraz z ich metodami
// oraz eksportowane funkcje najwyższego poziomu (równolegle na rdzeniach).
func (p *Plugin) Extract(ctx context.Context, appDir string) (*plugins.Entities, error) {
	files := collectGoFiles(appDir)

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

			for path := range jobs {
				els := parseFile(appDir, path)

				mu.Lock()
				out.Elements = append(out.Elements, els...)
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

// parseFile zwraca byty (typy + funkcje) z jednego pliku .go. Najpierw zbiera
// metody (receiver → typ), by dołączyć je do odpowiednich struktur/interfejsów.
func parseFile(appDir, path string) []plugins.Element {
	src, err := os.ReadFile(path)

	if err != nil {
		return nil
	}

	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, path, src, parser.SkipObjectResolution)

	if err != nil || file == nil {
		return nil
	}

	rel := relPath(appDir, path)

	// receiverType → lista nazw metod (np. "Scanner" → ["Run", "ScanAppDir"]).
	methods := map[string][]string{}

	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)

		if !ok || fn.Recv == nil || len(fn.Recv.List) == 0 {
			continue
		}

		recv := receiverType(fn.Recv.List[0].Type)

		if recv != "" {
			methods[recv] = append(methods[recv], fn.Name.Name)
		}
	}

	var els []plugins.Element

	for _, decl := range file.Decls {
		switch d := decl.(type) {
		case *ast.GenDecl:
			els = append(els, typeElements(d, rel, methods)...)

		case *ast.FuncDecl:
			// Tylko eksportowane funkcje wolne (bez receivera) — metody są przy typach.
			if d.Recv == nil && d.Name.IsExported() {
				els = append(els, plugins.Element{Kind: "function", Name: d.Name.Name, File: rel})
			}
		}
	}

	return els
}

// typeElements wyciąga byty z deklaracji `type (...)` — struct/interface jako
// "class" z dołączonymi metodami (i metodami interfejsu).
func typeElements(d *ast.GenDecl, rel string, methods map[string][]string) []plugins.Element {
	if d.Tok != token.TYPE {
		return nil
	}

	var els []plugins.Element

	for _, spec := range d.Specs {
		ts, ok := spec.(*ast.TypeSpec)

		if !ok || !ts.Name.IsExported() {
			continue
		}

		name := ts.Name.Name
		fns := append([]string{}, methods[name]...)

		switch ts.Type.(type) {
		case *ast.StructType:
			els = append(els, plugins.Element{Kind: "class", Name: name, File: rel, Functions: fns})

		case *ast.InterfaceType:
			els = append(els, plugins.Element{Kind: "class", Name: name, File: rel, Functions: append(fns, interfaceMethods(ts.Type)...)})
		}
	}

	return els
}

// interfaceMethods zwraca nazwy metod zadeklarowanych w interfejsie.
func interfaceMethods(t ast.Expr) []string {
	iface, ok := t.(*ast.InterfaceType)

	if !ok || iface.Methods == nil {
		return nil
	}

	var names []string

	for _, m := range iface.Methods.List {
		for _, n := range m.Names {
			names = append(names, n.Name)
		}
	}

	return names
}

// receiverType zwraca nazwę typu receivera (rozpakowuje wskaźnik *T → "T").
func receiverType(expr ast.Expr) string {
	switch t := expr.(type) {
	case *ast.StarExpr:
		return receiverType(t.X)

	case *ast.Ident:
		return t.Name
	}

	return ""
}

// --- pomocnicze: pliki ---

func isGoSource(name string) bool {
	if !strings.HasSuffix(name, ".go") {
		return false
	}

	return !strings.HasSuffix(name, "_test.go")
}

func collectGoFiles(appDir string) []string {
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

		if isGoSource(d.Name()) {
			files = append(files, path)
		}

		return nil
	})

	return files
}

func hasGoFiles(appDir string) bool {
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

		if isGoSource(d.Name()) {
			found = true

			return filepath.SkipAll
		}

		return nil
	})

	return found
}

func skipDir(name string) bool {
	switch name {
	case "node_modules", "dist", "build", "out", "vendor", ".git":
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
