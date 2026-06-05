// Package workspace wylicza aplikacje wchodzące w skład monorepo.
package workspace

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// App to pojedyncza aplikacja/serwis w monorepo (albo cały root przy pojedynczej app).
type App struct {
	Name string
	Path string // względem roota monorepo
}

// Apps zwraca listę aplikacji monorepo na podstawie globów workspaces
// (package.json "workspaces" oraz pnpm-workspace.yaml). Każdy katalog musi
// zawierać package.json. Gdy nic nie znaleziono, zwraca pustą listę.
func Apps(root string) []App {
	globs := append(packageJSONWorkspaces(root), pnpmWorkspaces(root)...)

	seen := map[string]bool{}
	var apps []App

	for _, g := range globs {
		matches, err := filepath.Glob(filepath.Join(root, g))

		if err != nil {
			continue
		}

		for _, dir := range matches {
			info, err := os.Stat(dir)

			if err != nil || !info.IsDir() {
				continue
			}

			if !exists(filepath.Join(dir, "package.json")) {
				continue
			}

			rel, err := filepath.Rel(root, dir)

			if err != nil || seen[rel] {
				continue
			}

			seen[rel] = true

			apps = append(apps, App{Name: filepath.Base(dir), Path: rel})
		}
	}

	sort.Slice(apps, func(i, j int) bool {
		return apps[i].Path < apps[j].Path
	})

	return apps
}

func packageJSONWorkspaces(root string) []string {
	data, err := os.ReadFile(filepath.Join(root, "package.json"))

	if err != nil {
		return nil
	}

	// "workspaces" bywa tablicą albo obiektem { "packages": [...] }.
	var asArray struct {
		Workspaces []string `json:"workspaces"`
	}

	if err := json.Unmarshal(data, &asArray); err == nil && len(asArray.Workspaces) > 0 {
		return asArray.Workspaces
	}

	var asObject struct {
		Workspaces struct {
			Packages []string `json:"packages"`
		} `json:"workspaces"`
	}

	if err := json.Unmarshal(data, &asObject); err == nil {
		return asObject.Workspaces.Packages
	}

	return nil
}

func pnpmWorkspaces(root string) []string {
	data, err := os.ReadFile(filepath.Join(root, "pnpm-workspace.yaml"))

	if err != nil {
		return nil
	}

	// Lekki parser: zbieramy wpisy "- glob" w sekcji packages, bez zależności od YAML.
	var globs []string

	for _, line := range strings.Split(string(data), "\n") {
		trimmed := strings.TrimSpace(line)

		if !strings.HasPrefix(trimmed, "- ") {
			continue
		}

		g := strings.Trim(strings.TrimPrefix(trimmed, "- "), `"'`)

		if g != "" {
			globs = append(globs, g)
		}
	}

	return globs
}

func exists(path string) bool {
	_, err := os.Stat(path)

	return err == nil
}
