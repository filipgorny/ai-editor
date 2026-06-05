// Package detect rozpoznaje typ projektu w danym katalogu.
package detect

import (
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// Detect zwraca "monorepo", "typescript-app" albo "" gdy nie rozpoznano.
func Detect(root string) string {
	if isMonorepo(root) {
		return "monorepo"
	}

	if isTypeScript(root) {
		return "typescript-app"
	}

	return ""
}

func isMonorepo(root string) bool {
	for _, name := range []string{"pnpm-workspace.yaml", "turbo.json", "nx.json", "lerna.json"} {
		if exists(filepath.Join(root, name)) {
			return true
		}
	}

	return packageJSONHasWorkspaces(filepath.Join(root, "package.json"))
}

func isTypeScript(root string) bool {
	if exists(filepath.Join(root, "tsconfig.json")) {
		return true
	}

	return hasTSFiles(root)
}

func packageJSONHasWorkspaces(path string) bool {
	data, err := os.ReadFile(path)

	if err != nil {
		return false
	}

	var pkg struct {
		Workspaces json.RawMessage `json:"workspaces"`
	}

	if err := json.Unmarshal(data, &pkg); err != nil {
		return false
	}

	return len(pkg.Workspaces) > 0
}

func hasTSFiles(root string) bool {
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

		name := d.Name()

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
	case "node_modules", "dist", "build", "out", "coverage", "vendor":
		return true
	}

	return strings.HasPrefix(name, ".")
}

func exists(path string) bool {
	_, err := os.Stat(path)

	return err == nil
}
