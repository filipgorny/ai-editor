// Package classifiers identifies, FROM EVIDENCE ON DISK (manifests, dependency
// declarations, source files — never the directory name), the LANGUAGE and FRAMEWORK of a
// workspace directory, and whether it is a runnable application or a reusable package.
//
// There are two kinds of classifier, each a small struct that scores how sure it is (0–100):
//   - LanguageClassifier  — recognises a programming language.
//   - FrameworkClassifier — recognises a framework, declaring which language it belongs to.
//
// Classify() works in two stages: it first picks the highest-scoring LANGUAGE, then narrows
// the framework candidates to that language and picks the highest-scoring FRAMEWORK. It
// returns the pair {Language, Framework} (+ app/package). The struct lists live in
// languages.go and frameworks.go.
package classifiers

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

const (
	KindApp     = "app"
	KindPackage = "package"
)

// LanguageClassifier scores how strongly a directory is written in one language (0–100).
type LanguageClassifier interface {
	Language() string
	Score(dir string) int
}

// FrameworkClassifier scores how strongly a directory uses one framework (0–100) and whether
// that framework makes it an application. It declares its Language so Classify can narrow the
// candidate frameworks to the detected language first.
type FrameworkClassifier interface {
	Framework() string
	Language() string
	// Score returns the match strength and whether the match indicates an application (vs a
	// library/package).
	Score(dir string) (score int, app bool)
}

// Result is the classification: the language/framework pair plus app-vs-package.
type Result struct {
	Language  string
	Framework string
	Kind      string
}

// Classify runs the two stages (language, then framework narrowed by that language) and
// returns the result. ok=false when no language matched (the caller may then ask the AI).
func Classify(dir string) (Result, bool) {
	// Stage 1 — language: the highest score wins.
	language, langScore := "", 0

	for _, lc := range languageClassifiers {
		if s := lc.Score(dir); s > langScore {
			langScore, language = s, lc.Language()
		}
	}

	if language == "" {
		return Result{}, false
	}

	// Stage 2 — framework: only those declared for this language, highest score wins.
	framework, fwScore, isApp := "", 0, false

	for _, fc := range frameworkClassifiers {
		// A framework declares its language; "" means it spans languages (e.g. Node
		// frameworks that work in both TypeScript and JavaScript).
		if fc.Language() != "" && fc.Language() != language {
			continue
		}

		if s, app := fc.Score(dir); s > fwScore {
			fwScore, framework, isApp = s, fc.Framework(), app
		}
	}

	kind := KindPackage

	if isApp {
		kind = KindApp
	}

	return Result{Language: language, Framework: framework, Kind: kind}, true
}

// — shared fs helpers used by the classifier structs —

func fileExists(path string) bool {
	info, err := os.Stat(path)

	return err == nil && !info.IsDir()
}

func dirExists(path string) bool {
	info, err := os.Stat(path)

	return err == nil && info.IsDir()
}

func anyFile(dir string, names ...string) bool {
	for _, n := range names {
		if fileExists(filepath.Join(dir, n)) {
			return true
		}
	}

	return false
}

func readFile(path string) string {
	data, err := os.ReadFile(path)

	if err != nil {
		return ""
	}

	return string(data)
}

func depsOf(dir string) map[string]string {
	var pkg struct {
		Deps    map[string]string `json:"dependencies"`
		DevDeps map[string]string `json:"devDependencies"`
	}

	data, err := os.ReadFile(filepath.Join(dir, "package.json"))

	if err != nil || json.Unmarshal(data, &pkg) != nil {
		return nil
	}

	out := map[string]string{}

	for k, v := range pkg.Deps {
		out[k] = v
	}

	for k, v := range pkg.DevDeps {
		out[k] = v
	}

	return out
}

func skipDir(name string) bool {
	switch name {
	case "node_modules", ".git", "dist", "build", "out", ".next", "vendor", "target", ".cache", ".idea", ".vscode":
		return true
	}

	return strings.HasPrefix(name, "bazel-")
}

// hasExt reports whether the subtree contains a file ending with any of exts.
func hasExt(dir string, exts ...string) bool {
	found := false

	_ = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}

		if d.IsDir() {
			if path != dir && skipDir(d.Name()) {
				return filepath.SkipDir
			}

			return nil
		}

		for _, ext := range exts {
			if strings.HasSuffix(d.Name(), ext) {
				found = true

				return filepath.SkipAll
			}
		}

		return nil
	})

	return found
}

// SniffLanguage returns the dominant source language by file extension, or "" if unknown.
// Used as a last resort when no manifest-based classifier matched.
func SniffLanguage(dir string) string {
	ext := map[string]string{
		".ts": "typescript", ".tsx": "typescript",
		".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
		".go": "go", ".java": "java", ".kt": "kotlin", ".kts": "kotlin", ".rs": "rust",
		".py": "python", ".rb": "ruby", ".php": "php", ".ex": "elixir", ".exs": "elixir",
		".dart": "dart", ".swift": "swift", ".cs": "csharp", ".scala": "scala",
		".c": "c", ".cc": "cpp", ".cpp": "cpp", ".hpp": "cpp",
	}

	counts := map[string]int{}

	_ = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}

		if d.IsDir() {
			if path != dir && skipDir(d.Name()) {
				return filepath.SkipDir
			}

			return nil
		}

		if lang := ext[filepath.Ext(d.Name())]; lang != "" {
			counts[lang]++
		}

		return nil
	})

	best, bestN := "", 0

	for lang, n := range counts {
		if n > bestN {
			best, bestN = lang, n
		}
	}

	return best
}

// grep reports whether any file with one of exts under dir contains any needle.
func grep(dir string, exts []string, needles ...string) bool {
	found := false

	_ = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}

		if d.IsDir() {
			if path != dir && skipDir(d.Name()) {
				return filepath.SkipDir
			}

			return nil
		}

		match := false

		for _, ext := range exts {
			if strings.HasSuffix(d.Name(), ext) {
				match = true

				break
			}
		}

		if !match {
			return nil
		}

		content := readFile(path)

		for _, n := range needles {
			if strings.Contains(content, n) {
				found = true

				return filepath.SkipAll
			}
		}

		return nil
	})

	return found
}
