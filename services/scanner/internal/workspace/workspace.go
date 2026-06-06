// Package workspace wylicza aplikacje wchodzące w skład monorepo.
package workspace

import (
	"encoding/json"
	"io/fs"
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

// Apps zwraca listę aplikacji monorepo. Łączy trzy źródła: globy workspaces JS/TS
// (package.json "workspaces" + pnpm-workspace.yaml), serwisy Go (katalogi z
// `cmd/<x>/main.go`) oraz pakiety Protobuf (katalogi najwyższego poziomu z .proto).
// Ścieżki są deduplikowane — pierwsze źródło wygrywa. Gdy nic nie znaleziono,
// zwraca pustą listę.
func Apps(root string) []App {
	seen := map[string]bool{}
	var apps []App

	add := func(found []App) {
		for _, a := range found {
			if a.Path == "" || seen[a.Path] {
				continue
			}

			seen[a.Path] = true
			apps = append(apps, a)
		}
	}

	add(jsApps(root))
	add(GoApps(root))
	add(ProtoApps(root))

	sort.Slice(apps, func(i, j int) bool {
		return apps[i].Path < apps[j].Path
	})

	return apps
}

// jsApps wylicza aplikacje JS/TS z globów workspaces. Każdy katalog musi zawierać
// package.json.
func jsApps(root string) []App {
	globs := append(packageJSONWorkspaces(root), pnpmWorkspaces(root)...)

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

			if err != nil {
				continue
			}

			apps = append(apps, App{Name: filepath.Base(dir), Path: rel})
		}
	}

	return apps
}

// GoApps wykrywa serwisy Go po konwencji `cmd/<nazwa>/main.go` — korzeniem
// aplikacji jest katalog zawierający `cmd` (np. services/git/cmd/git/main.go →
// services/git). Pozwala to rozpoznać każdy uruchamialny serwis monorepo Go.
func GoApps(root string) []App {
	seen := map[string]bool{}
	var apps []App

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

		if d.Name() != "main.go" {
			return nil
		}

		appRoot := serviceRootFromCmd(path)

		if appRoot == "" {
			return nil
		}

		rel, err := filepath.Rel(root, appRoot)

		if err != nil || rel == "." || seen[rel] {
			return nil
		}

		seen[rel] = true
		apps = append(apps, App{Name: filepath.Base(appRoot), Path: rel})

		return nil
	})

	return apps
}

// serviceRootFromCmd zwraca korzeń serwisu dla pliku main.go leżącego pod `cmd/`
// (katalog tuż przed komponentem ścieżki "cmd"); pusty string, gdy main.go nie
// znajduje się w układzie cmd/.
func serviceRootFromCmd(mainPath string) string {
	parts := strings.Split(filepath.ToSlash(filepath.Dir(mainPath)), "/")

	for i := len(parts) - 1; i >= 0; i-- {
		if parts[i] == "cmd" {
			return filepath.FromSlash(strings.Join(parts[:i], "/"))
		}
	}

	return ""
}

// ProtoApps grupuje pliki .proto po katalogu najwyższego poziomu (względem roota)
// i tworzy z każdego takiego katalogu jedną aplikację Protobuf (np. proto). Dzięki
// temu modele można przeglądać jako osobną aplikację na grafie.
func ProtoApps(root string) []App {
	seen := map[string]bool{}
	var apps []App

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

		if !strings.HasSuffix(d.Name(), ".proto") {
			return nil
		}

		rel, err := filepath.Rel(root, path)

		if err != nil {
			return nil
		}

		top := strings.SplitN(filepath.ToSlash(rel), "/", 2)[0]

		if top == "" || top == filepath.ToSlash(rel) || seen[top] {
			return nil
		}

		seen[top] = true
		apps = append(apps, App{Name: top, Path: top})

		return nil
	})

	return apps
}

func skipDir(name string) bool {
	switch name {
	case "node_modules", "dist", "build", "out", "vendor", ".git", ".idea", ".vscode":
		return true
	}

	return false
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
