package server

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	filerv1 "github.com/filipgorny/ai-architect/proto/filer/v1"
)

var camelRe = regexp.MustCompile(`[a-z][A-Z]`)

// sourceExt — rozszerzenia plików KODU (do wykrycia języka katalogu). Pomijamy
// pliki konfiguracyjne/danych (bazel, json, yaml, md…), by nie zgadywać np. .bazel.
var sourceExt = map[string]bool{
	"ts": true, "tsx": true, "js": true, "jsx": true, "mjs": true, "cjs": true,
	"go": true, "py": true, "rb": true, "java": true, "kt": true, "rs": true,
	"vue": true, "svelte": true, "php": true, "cs": true, "cpp": true, "c": true, "h": true,
}

// Conventions wykrywa konwencję nazw plików (dash/camel) i dominujące
// rozszerzenie, patrząc na pliki w katalogu i jeden poziom wyżej.
func (s *Server) Conventions(_ context.Context, req *filerv1.PathReq) (*filerv1.ConventionInfo, error) {
	dir := req.GetPath()

	if dir == "" {
		if home, err := os.UserHomeDir(); err == nil {
			dir = home
		}
	}

	// gdy podano plik, użyj jego katalogu
	if info, err := os.Stat(dir); err == nil && !info.IsDir() {
		dir = filepath.Dir(dir)
	}

	dash, camel := 0, 0
	exts := map[string]int{}

	scan := func(d string) {
		entries, err := os.ReadDir(d)

		if err != nil {
			return
		}

		for _, e := range entries {
			if e.IsDir() {
				continue
			}

			name := e.Name()
			ext := strings.TrimPrefix(filepath.Ext(name), ".")

			// licz tylko rozszerzenia KODU (pomijaj bazel/json/yaml/md itp.)
			if sourceExt[ext] {
				exts[ext]++
			}

			base := strings.TrimSuffix(name, filepath.Ext(name))

			if strings.Contains(base, "-") {
				dash++
			} else if camelRe.MatchString(base) {
				camel++
			}
		}
	}

	scan(dir)
	scan(filepath.Dir(dir)) // też katalog wyżej

	convention := "dash"

	if camel > dash {
		convention = "camel"
	}

	best, max := "ts", 0

	for ext, c := range exts {
		if c > max {
			max, best = c, ext
		}
	}

	return &filerv1.ConventionInfo{Convention: convention, Extension: best}, nil
}
