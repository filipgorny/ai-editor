// Language classifiers — one struct per language. Each scores 0–100 how strongly a
// directory is written in that language, from manifests first and source extensions second.
// (Kept in one file for now; each struct can move to its own file without changing callers.)
package classifiers

import "path/filepath"

// languageClassifiers is the catalog consulted by Classify (stage 1).
var languageClassifiers = []LanguageClassifier{
	typescriptLang{},
	javascriptLang{},
	goLang{},
	pythonLang{},
	javaLang{},
	kotlinLang{},
	rustLang{},
	csharpLang{},
	phpLang{},
	rubyLang{},
	elixirLang{},
	dartLang{},
	swiftLang{},
	scalaLang{},
	cppLang{},
}

type typescriptLang struct{}

func (typescriptLang) Language() string { return "typescript" }
func (typescriptLang) Score(dir string) int {
	if fileExists(filepath.Join(dir, "tsconfig.json")) {
		return 95
	}

	if hasExt(dir, ".ts", ".tsx") {
		return 80
	}

	return 0
}

type javascriptLang struct{}

func (javascriptLang) Language() string { return "javascript" }
func (javascriptLang) Score(dir string) int {
	// Lower than TypeScript so a TS project (which also has package.json) resolves to TS.
	if fileExists(filepath.Join(dir, "package.json")) {
		return 60
	}

	if hasExt(dir, ".js", ".jsx", ".mjs", ".cjs") {
		return 50
	}

	return 0
}

type goLang struct{}

func (goLang) Language() string { return "go" }
func (goLang) Score(dir string) int {
	if fileExists(filepath.Join(dir, "go.mod")) {
		return 100
	}

	if hasExt(dir, ".go") {
		return 70
	}

	return 0
}

type pythonLang struct{}

func (pythonLang) Language() string { return "python" }
func (pythonLang) Score(dir string) int {
	if anyFile(dir, "pyproject.toml", "setup.py", "requirements.txt", "Pipfile") {
		return 95
	}

	if hasExt(dir, ".py") {
		return 70
	}

	return 0
}

type javaLang struct{}

func (javaLang) Language() string { return "java" }
func (javaLang) Score(dir string) int {
	if anyFile(dir, "pom.xml", "build.gradle") {
		return 90
	}

	if hasExt(dir, ".java") {
		return 60
	}

	return 0
}

type kotlinLang struct{}

func (kotlinLang) Language() string { return "kotlin" }
func (kotlinLang) Score(dir string) int {
	if fileExists(filepath.Join(dir, "build.gradle.kts")) {
		return 90
	}

	if hasExt(dir, ".kt", ".kts") {
		return 70
	}

	return 0
}

type rustLang struct{}

func (rustLang) Language() string { return "rust" }
func (rustLang) Score(dir string) int {
	if fileExists(filepath.Join(dir, "Cargo.toml")) {
		return 100
	}

	if hasExt(dir, ".rs") {
		return 70
	}

	return 0
}

type csharpLang struct{}

func (csharpLang) Language() string { return "csharp" }
func (csharpLang) Score(dir string) int {
	if hasExt(dir, ".csproj", ".sln") {
		return 95
	}

	if hasExt(dir, ".cs") {
		return 70
	}

	return 0
}

type phpLang struct{}

func (phpLang) Language() string { return "php" }
func (phpLang) Score(dir string) int {
	if fileExists(filepath.Join(dir, "composer.json")) {
		return 90
	}

	if hasExt(dir, ".php") {
		return 60
	}

	return 0
}

type rubyLang struct{}

func (rubyLang) Language() string { return "ruby" }
func (rubyLang) Score(dir string) int {
	if anyFile(dir, "Gemfile", "Rakefile") {
		return 90
	}

	if hasExt(dir, ".rb") {
		return 60
	}

	return 0
}

type elixirLang struct{}

func (elixirLang) Language() string { return "elixir" }
func (elixirLang) Score(dir string) int {
	if fileExists(filepath.Join(dir, "mix.exs")) {
		return 95
	}

	if hasExt(dir, ".ex", ".exs") {
		return 70
	}

	return 0
}

type dartLang struct{}

func (dartLang) Language() string { return "dart" }
func (dartLang) Score(dir string) int {
	if fileExists(filepath.Join(dir, "pubspec.yaml")) {
		return 95
	}

	if hasExt(dir, ".dart") {
		return 70
	}

	return 0
}

type swiftLang struct{}

func (swiftLang) Language() string { return "swift" }
func (swiftLang) Score(dir string) int {
	if fileExists(filepath.Join(dir, "Package.swift")) {
		return 95
	}

	if hasExt(dir, ".swift") {
		return 70
	}

	return 0
}

type scalaLang struct{}

func (scalaLang) Language() string { return "scala" }
func (scalaLang) Score(dir string) int {
	if fileExists(filepath.Join(dir, "build.sbt")) {
		return 95
	}

	if hasExt(dir, ".scala") {
		return 70
	}

	return 0
}

type cppLang struct{}

func (cppLang) Language() string { return "cpp" }
func (cppLang) Score(dir string) int {
	if fileExists(filepath.Join(dir, "CMakeLists.txt")) {
		return 85
	}

	if hasExt(dir, ".cpp", ".cc", ".hpp") {
		return 60
	}

	return 0
}
