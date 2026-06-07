// Framework classifiers — one struct per framework. Each scores 0–100 how strongly a
// directory uses that framework and whether that makes it an application. Language() narrows
// candidates to the detected language ("" = any, used by Node frameworks that work in both
// TypeScript and JavaScript). The low-scoring "generic" entries detect a frameworkless app
// (e.g. a Go binary) so plain applications still resolve to kind=app.
package classifiers

import (
	"path/filepath"
	"strings"
)

// frameworkClassifiers is the catalog consulted by Classify (stage 2).
var frameworkClassifiers = []FrameworkClassifier{
	// Node (TypeScript/JavaScript)
	nestjsFW{}, nextjsFW{}, angularFW{}, reactFW{}, vueFW{}, svelteFW{},
	expressFW{}, fastifyFW{}, koaFW{}, electronFW{}, reactNativeFW{},
	// JVM
	springBootFW{},
	// Python
	djangoFW{}, flaskFW{}, fastapiFW{},
	// Ruby / PHP
	railsFW{}, laravelFW{}, symfonyFW{},
	// frameworkless application detectors
	goAppFW{}, rustAppFW{},
}

func dep(dir, name string) bool {
	_, ok := depsOf(dir)[name]

	return ok
}

// — Node frameworks (Language "" → any of typescript/javascript) —

type nestjsFW struct{}

func (nestjsFW) Framework() string { return "nestjs" }
func (nestjsFW) Language() string  { return "" }
func (nestjsFW) Score(dir string) (int, bool) {
	if dep(dir, "@nestjs/core") {
		return 95, true
	}

	return 0, false
}

type nextjsFW struct{}

func (nextjsFW) Framework() string { return "nextjs" }
func (nextjsFW) Language() string  { return "" }
func (nextjsFW) Score(dir string) (int, bool) {
	if dep(dir, "next") {
		return 95, true
	}

	return 0, false
}

type angularFW struct{}

func (angularFW) Framework() string { return "angular" }
func (angularFW) Language() string  { return "" }
func (angularFW) Score(dir string) (int, bool) {
	if dep(dir, "@angular/core") {
		return 95, true
	}

	return 0, false
}

type reactFW struct{}

func (reactFW) Framework() string { return "react" }
func (reactFW) Language() string  { return "" }
func (reactFW) Score(dir string) (int, bool) {
	// react-dom → a React application; react alone → a React library (package).
	if dep(dir, "react-dom") {
		return 90, true
	}

	if dep(dir, "react") {
		return 70, false
	}

	return 0, false
}

type vueFW struct{}

func (vueFW) Framework() string { return "vue" }
func (vueFW) Language() string  { return "" }
func (vueFW) Score(dir string) (int, bool) {
	if dep(dir, "nuxt") {
		return 92, true
	}

	// Require real Vue usage (.vue components), not just a `vue` dependency — a plain TS
	// package that happens to depend on vue is not a Vue app.
	if dep(dir, "vue") && hasExt(dir, ".vue") {
		return 80, true
	}

	return 0, false
}

type svelteFW struct{}

func (svelteFW) Framework() string { return "svelte" }
func (svelteFW) Language() string  { return "" }
func (svelteFW) Score(dir string) (int, bool) {
	// Require real Svelte usage (.svelte components or a svelte.config), not merely a `svelte`
	// dependency — a plain TS package that lists svelte is NOT a Svelte project (this is what
	// caused plain util functions to be mislabelled "svelte").
	hasSvelte := hasExt(dir, ".svelte") ||
		fileExists(filepath.Join(dir, "svelte.config.js")) ||
		fileExists(filepath.Join(dir, "svelte.config.ts"))

	if !hasSvelte {
		return 0, false
	}

	if dep(dir, "@sveltejs/kit") {
		return 92, true
	}

	if dep(dir, "svelte") {
		return 75, false
	}

	return 0, false
}

type expressFW struct{}

func (expressFW) Framework() string { return "express" }
func (expressFW) Language() string  { return "" }
func (expressFW) Score(dir string) (int, bool) {
	if dep(dir, "express") {
		return 80, true
	}

	return 0, false
}

type fastifyFW struct{}

func (fastifyFW) Framework() string { return "fastify" }
func (fastifyFW) Language() string  { return "" }
func (fastifyFW) Score(dir string) (int, bool) {
	if dep(dir, "fastify") {
		return 80, true
	}

	return 0, false
}

type koaFW struct{}

func (koaFW) Framework() string { return "koa" }
func (koaFW) Language() string  { return "" }
func (koaFW) Score(dir string) (int, bool) {
	if dep(dir, "koa") {
		return 78, true
	}

	return 0, false
}

type electronFW struct{}

func (electronFW) Framework() string { return "electron" }
func (electronFW) Language() string  { return "" }
func (electronFW) Score(dir string) (int, bool) {
	if dep(dir, "electron") {
		return 90, true
	}

	return 0, false
}

type reactNativeFW struct{}

func (reactNativeFW) Framework() string { return "react-native" }
func (reactNativeFW) Language() string  { return "" }
func (reactNativeFW) Score(dir string) (int, bool) {
	if dep(dir, "react-native") {
		return 92, true
	}

	return 0, false
}

// — JVM —

type springBootFW struct{}

func (springBootFW) Framework() string { return "spring-boot" }
func (springBootFW) Language() string  { return "java" }
func (springBootFW) Score(dir string) (int, bool) {
	for _, f := range []string{"pom.xml", "build.gradle", "build.gradle.kts"} {
		if contains(readFile(filepath.Join(dir, f)), "spring-boot") {
			return 95, true
		}
	}

	if grep(filepath.Join(dir, "src"), []string{".java", ".kt"}, "@SpringBootApplication") {
		return 90, true
	}

	return 0, false
}

// — Python —

type djangoFW struct{}

func (djangoFW) Framework() string { return "django" }
func (djangoFW) Language() string  { return "python" }
func (djangoFW) Score(dir string) (int, bool) {
	if fileExists(filepath.Join(dir, "manage.py")) || grep(dir, []string{".txt", ".toml", ".cfg"}, "Django", "django") {
		return 90, true
	}

	return 0, false
}

type flaskFW struct{}

func (flaskFW) Framework() string { return "flask" }
func (flaskFW) Language() string  { return "python" }
func (flaskFW) Score(dir string) (int, bool) {
	if grep(dir, []string{".txt", ".toml", ".cfg", ".py"}, "Flask", "flask") {
		return 80, true
	}

	return 0, false
}

type fastapiFW struct{}

func (fastapiFW) Framework() string { return "fastapi" }
func (fastapiFW) Language() string  { return "python" }
func (fastapiFW) Score(dir string) (int, bool) {
	if grep(dir, []string{".txt", ".toml", ".cfg", ".py"}, "fastapi", "FastAPI") {
		return 82, true
	}

	return 0, false
}

// — Ruby / PHP —

type railsFW struct{}

func (railsFW) Framework() string { return "rails" }
func (railsFW) Language() string  { return "ruby" }
func (railsFW) Score(dir string) (int, bool) {
	if contains(readFile(filepath.Join(dir, "Gemfile")), "rails") {
		return 95, true
	}

	return 0, false
}

type laravelFW struct{}

func (laravelFW) Framework() string { return "laravel" }
func (laravelFW) Language() string  { return "php" }
func (laravelFW) Score(dir string) (int, bool) {
	if contains(readFile(filepath.Join(dir, "composer.json")), "laravel/framework") {
		return 95, true
	}

	return 0, false
}

type symfonyFW struct{}

func (symfonyFW) Framework() string { return "symfony" }
func (symfonyFW) Language() string  { return "php" }
func (symfonyFW) Score(dir string) (int, bool) {
	if contains(readFile(filepath.Join(dir, "composer.json")), "symfony/") {
		return 88, true
	}

	return 0, false
}

// — frameworkless application detectors (low score; a named framework always wins) —

type goAppFW struct{}

func (goAppFW) Framework() string { return "" }
func (goAppFW) Language() string  { return "go" }
func (goAppFW) Score(dir string) (int, bool) {
	if grep(dir, []string{".go"}, "package main") {
		return 40, true
	}

	return 0, false
}

type rustAppFW struct{}

func (rustAppFW) Framework() string { return "" }
func (rustAppFW) Language() string  { return "rust" }
func (rustAppFW) Score(dir string) (int, bool) {
	if fileExists(filepath.Join(dir, "src", "main.rs")) || dirExists(filepath.Join(dir, "src", "bin")) {
		return 40, true
	}

	return 0, false
}

func contains(haystack, needle string) bool {
	return haystack != "" && strings.Contains(haystack, needle)
}
