// Package vite to plugin frontendu opartego o Vite (np. Vue/vanilla/Svelte build
// na Vite, które nie są Reactem). Rozpoznaje aplikację po pliku konfiguracyjnym
// vite.config.* albo zależności "vite" w package.json. Nie ma własnego parsera
// encji — etykietuje aplikację (framework + ikona); ekstrakcję ewentualnych
// komponentów robią inne pluginy (np. react) w głębokim skanie.
package vite

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/filipgorny/ai-architect/plugins"
)

func init() {
	plugins.Register(&Plugin{})
}

// Plugin implementuje plugins.Plugin dla Vite.
type Plugin struct{}

func (p *Plugin) Framework() string {
	return "vite"
}

// Detect uznaje katalog za Vite po pliku vite.config.* albo zależności "vite".
func (p *Plugin) Detect(appDir string) bool {
	for _, f := range []string{"vite.config.ts", "vite.config.js", "vite.config.mjs", "vite.config.mts", "vite.config.cjs"} {
		if exists(filepath.Join(appDir, f)) {
			return true
		}
	}

	return packageDependsOnVite(filepath.Join(appDir, "package.json"))
}

// Extract nic nie zwraca — Vite to tylko etykieta; komponenty (jeśli są) wyciągają
// inne pluginy uruchamiane na tym samym katalogu.
func (p *Plugin) Extract(_ context.Context, _ string) (*plugins.Entities, error) {
	return &plugins.Entities{}, nil
}

func packageDependsOnVite(path string) bool {
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

	if _, ok := pkg.Dependencies["vite"]; ok {
		return true
	}

	_, ok := pkg.DevDependencies["vite"]

	return ok
}

func exists(path string) bool {
	_, err := os.Stat(path)

	return err == nil
}
