// Package typescript to FALLBACKOWY plugin aplikacji TypeScript — łapie apki/serwisy
// w TS, które nie pasują do konkretniejszego frameworka (nestjs/react/vite). Dzięki
// niemu zwykła apka TS dostaje etykietę i ikonę (nie zostaje bez frameworka). Musi być
// OSTATNI w kolejności resolvera, żeby nie przykrywał konkretniejszych pluginów.
package typescript

import (
	"context"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/filipgorny/ai-architect/plugins"
)

func init() {
	plugins.Register(&Plugin{})
}

// Plugin implementuje plugins.Plugin dla generycznego TypeScriptu.
type Plugin struct{}

func (p *Plugin) Framework() string {
	return "typescript"
}

// Detect uznaje katalog za TS, gdy ma tsconfig.json, zależność "typescript" albo
// jakikolwiek plik .ts/.tsx.
func (p *Plugin) Detect(appDir string) bool {
	if exists(filepath.Join(appDir, "tsconfig.json")) {
		return true
	}

	return hasTSFiles(appDir)
}

// Extract nic nie zwraca — to tylko etykieta. Ewentualne encje wyciągają pluginy
// konkretnych frameworków uruchamiane na tym samym katalogu w głębokim skanie.
func (p *Plugin) Extract(_ context.Context, _ string) (*plugins.Entities, error) {
	return &plugins.Entities{}, nil
}

func hasTSFiles(appDir string) bool {
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

		name := d.Name()

		if strings.HasSuffix(name, ".d.ts") {
			return nil
		}

		if strings.HasSuffix(name, ".ts") || strings.HasSuffix(name, ".tsx") {
			found = true

			return filepath.SkipAll
		}

		return nil
	})

	return found
}

func skipDir(name string) bool {
	switch name {
	case "node_modules", "dist", "build", "out", "coverage", "vendor", ".git":
		return true
	}

	return strings.HasPrefix(name, ".")
}

func exists(path string) bool {
	_, err := os.Stat(path)

	return err == nil
}
