// Package links does language-aware "go to definition" analysis for a single source file.
// It uses tree-sitter to locate import paths and imported-symbol usages, then resolves each
// to the file (and best-effort line) it points at. This is the offline baseline; an LSP
// backend can later refine the target line. Only the scanner does this code analysis.
package links

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"

	sitter "github.com/smacker/go-tree-sitter"
	"github.com/smacker/go-tree-sitter/golang"
	"github.com/smacker/go-tree-sitter/javascript"
	"github.com/smacker/go-tree-sitter/typescript/tsx"
	"github.com/smacker/go-tree-sitter/typescript/typescript"
)

// Link is a clickable span in the source resolving to a definition. Positions are 0-based;
// columns are byte offsets within the line (matches tree-sitter points).
type Link struct {
	FromLine, FromCol uint32
	ToLine, ToCol     uint32
	TargetPath        string
	TargetLine        uint32
}

// Analyze returns the navigable links in a file, dispatching on its language.
func Analyze(path, content string) []Link {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".go":
		return analyzeGo(path, []byte(content))

	case ".ts":
		return analyzeJS(path, []byte(content), typescript.GetLanguage())

	case ".tsx":
		return analyzeJS(path, []byte(content), tsx.GetLanguage())

	case ".js", ".jsx", ".mjs", ".cjs":
		return analyzeJS(path, []byte(content), javascript.GetLanguage())
	}

	return nil
}

func parse(lang *sitter.Language, src []byte) *sitter.Node {
	p := sitter.NewParser()
	p.SetLanguage(lang)

	tree, err := p.ParseCtx(context.Background(), nil, src)

	if err != nil || tree == nil {
		return nil
	}

	return tree.RootNode()
}

// walk visits every named node depth-first.
func walk(n *sitter.Node, fn func(*sitter.Node)) {
	if n == nil {
		return
	}

	fn(n)

	for i := 0; i < int(n.NamedChildCount()); i++ {
		walk(n.NamedChild(i), fn)
	}
}

func nodeLink(n *sitter.Node, target string, targetLine uint32) Link {
	s := n.StartPoint()
	e := n.EndPoint()

	return Link{
		FromLine:   s.Row,
		FromCol:    s.Column,
		ToLine:     e.Row,
		ToCol:      e.Column,
		TargetPath: target,
		TargetLine: targetLine,
	}
}

func unquote(s string) string {
	return strings.Trim(s, "\"'`")
}

// --- Go ---

func analyzeGo(path string, src []byte) []Link {
	root := parse(golang.GetLanguage(), src)

	if root == nil {
		return nil
	}

	var out []Link
	pkgImport := map[string]string{} // package identifier → import path

	walk(root, func(n *sitter.Node) {
		if n.Type() != "import_spec" {
			return
		}

		pathNode := n.ChildByFieldName("path")

		if pathNode == nil {
			return
		}

		imp := unquote(pathNode.Content(src))
		name := lastSegment(imp)

		if nameNode := n.ChildByFieldName("name"); nameNode != nil {
			nm := nameNode.Content(src)

			if nm == "_" || nm == "." {
				name = ""
			} else {
				name = nm
			}
		}

		target := resolveGo(path, imp)

		if name != "" && target != "" {
			pkgImport[name] = target
		}

		if target != "" {
			out = append(out, nodeLink(pathNode, target, 0))
		}
	})

	walk(root, func(n *sitter.Node) {
		if n.Type() != "selector_expression" {
			return
		}

		op := n.ChildByFieldName("operand")

		if op == nil || op.Type() != "identifier" {
			return
		}

		target := pkgImport[op.Content(src)]

		if target == "" {
			return
		}

		line := uint32(0)
		field := n.ChildByFieldName("field")

		if field != nil {
			if f, l := findGoDecl(filepath.Dir(target), field.Content(src)); f != "" {
				target = f
				line = l
			}
		}

		out = append(out, nodeLink(op, target, line))

		if field != nil {
			out = append(out, nodeLink(field, target, line))
		}
	})

	return out
}

// resolveGo maps a Go import path to a source file. It resolves, in order: same-module
// packages (via the nearest go.mod), the standard library (via GOROOT), and third-party
// modules (via the module cache, honouring go.mod require/replace). Returns "" if nothing
// is found.
func resolveGo(from, spec string) string {
	modRoot, modPath := findGoModule(filepath.Dir(from))

	if modPath != "" && (spec == modPath || strings.HasPrefix(spec, modPath+"/")) {
		rel := strings.TrimPrefix(strings.TrimPrefix(spec, modPath), "/")

		if f := pickGoFile(filepath.Join(modRoot, rel)); f != "" {
			return f
		}
	}

	if isStdlibImport(spec) {
		if root := runtime.GOROOT(); root != "" {
			if f := pickGoFile(filepath.Join(root, "src", spec)); f != "" {
				return f
			}
		}
	}

	if modRoot != "" {
		if f := resolveGoModule(modRoot, from, spec); f != "" {
			return f
		}
	}

	return ""
}

// isStdlibImport reports whether spec looks like a standard-library path — its first path
// element has no dot (the Go convention separating std from external modules).
func isStdlibImport(spec string) bool {
	first := spec

	if i := strings.IndexByte(spec, '/'); i >= 0 {
		first = spec[:i]
	}

	return first != "" && !strings.Contains(first, ".")
}

// resolveGoModule resolves a third-party import to a file in the module cache, using the
// project's go.mod to pick the module + version and to honour `replace` directives.
func resolveGoModule(modRoot, from, spec string) string {
	mod := parseGoMod(modRoot)
	best := longestModulePrefix(spec, mod.requires, mod.replaces)

	if best == "" {
		return ""
	}

	sub := strings.TrimPrefix(strings.TrimPrefix(spec, best), "/")

	if rep, ok := mod.replaces[best]; ok {
		if rep.local != "" {
			dir := rep.local

			if !filepath.IsAbs(dir) {
				dir = filepath.Join(modRoot, dir)
			}

			return pickGoFile(filepath.Join(dir, sub))
		}

		if rep.module != "" && rep.version != "" {
			return pickModuleFile(from, rep.module, rep.version, sub)
		}
	}

	ver := mod.requires[best]

	if ver == "" {
		return ""
	}

	return pickModuleFile(from, best, ver, sub)
}

// longestModulePrefix returns the longest module path (from requires or replaces) that
// prefixes spec, so nested modules resolve to the most specific one.
func longestModulePrefix(spec string, requires map[string]string, replaces map[string]goReplace) string {
	best := ""

	match := func(mod string) {
		if (spec == mod || strings.HasPrefix(spec, mod+"/")) && len(mod) > len(best) {
			best = mod
		}
	}

	for mod := range requires {
		match(mod)
	}

	for mod := range replaces {
		match(mod)
	}

	return best
}

// pickModuleFile finds a representative .go file for module@version/sub across the candidate
// module-cache roots (the scanner often runs in a container whose GOPATH isn't the host's).
func pickModuleFile(from, module, version, sub string) string {
	rel := filepath.Join(escapeModulePath(module)+"@"+version, sub)

	for _, root := range goModCacheRoots(from) {
		if f := pickGoFile(filepath.Join(root, rel)); f != "" {
			return f
		}
	}

	return ""
}

// goModCacheRoots lists candidate module-cache directories, most specific first: the env
// (GOMODCACHE / GOPATH), a cache derived from the host home in `from` (mounted 1:1 into the
// scanner), and the container default.
func goModCacheRoots(from string) []string {
	roots := make([]string, 0, 4)

	if c := os.Getenv("GOMODCACHE"); c != "" {
		roots = append(roots, c)
	}

	if gp := firstPathEntry(os.Getenv("GOPATH")); gp != "" {
		roots = append(roots, filepath.Join(gp, "pkg", "mod"))
	}

	if hc := hostGoModCache(from); hc != "" {
		roots = append(roots, hc)
	}

	return append(roots, "/go/pkg/mod")
}

func firstPathEntry(p string) string {
	if p == "" {
		return ""
	}

	if i := strings.IndexByte(p, os.PathListSeparator); i >= 0 {
		return p[:i]
	}

	return p
}

// hostGoModCache derives the host's default module cache (<home>/go/pkg/mod) from a path like
// /home/<user>/... or /Users/<user>/..., so a containerised scanner can read the host cache
// mounted 1:1 at the same path.
func hostGoModCache(from string) string {
	clean := filepath.ToSlash(from)

	for _, prefix := range []string{"/home/", "/Users/"} {
		if !strings.HasPrefix(clean, prefix) {
			continue
		}

		rest := clean[len(prefix):]
		i := strings.IndexByte(rest, '/')

		if i <= 0 {
			continue
		}

		return prefix + rest[:i] + "/go/pkg/mod"
	}

	return ""
}

// escapeModulePath applies Go module-cache case-encoding: each uppercase letter becomes
// "!" + its lowercase form (e.g. github.com/Azure → github.com/!azure).
func escapeModulePath(s string) string {
	var b strings.Builder

	for _, r := range s {
		if r >= 'A' && r <= 'Z' {
			b.WriteByte('!')
			b.WriteRune(r + ('a' - 'A'))

			continue
		}

		b.WriteRune(r)
	}

	return b.String()
}

// goReplace is a parsed go.mod replace target: either a local path, or a module@version.
type goReplace struct {
	local   string
	module  string
	version string
}

// goModFile is the parsed subset of go.mod we use: required modules → version, and replace
// directives keyed by the replaced module path.
type goModFile struct {
	requires map[string]string
	replaces map[string]goReplace
}

// parseGoMod reads and parses modRoot/go.mod (require + replace; line-based, no go tooling).
func parseGoMod(modRoot string) goModFile {
	out := goModFile{requires: map[string]string{}, replaces: map[string]goReplace{}}
	b, err := os.ReadFile(filepath.Join(modRoot, "go.mod"))

	if err != nil {
		return out
	}

	inRequire := false
	inReplace := false

	for _, raw := range strings.Split(string(b), "\n") {
		line := strings.TrimSpace(stripLineComment(raw))

		if line == "" {
			continue
		}

		if strings.HasPrefix(line, "require (") {
			inRequire = true

			continue
		}

		if strings.HasPrefix(line, "replace (") {
			inReplace = true

			continue
		}

		if line == ")" {
			inRequire = false
			inReplace = false

			continue
		}

		if rest := strings.TrimPrefix(line, "require "); rest != line {
			addGoRequire(out.requires, rest)

			continue
		}

		if rest := strings.TrimPrefix(line, "replace "); rest != line {
			addGoReplace(out.replaces, rest)

			continue
		}

		if inRequire {
			addGoRequire(out.requires, line)
		} else if inReplace {
			addGoReplace(out.replaces, line)
		}
	}

	return out
}

func stripLineComment(s string) string {
	if i := strings.Index(s, "//"); i >= 0 {
		return s[:i]
	}

	return s
}

func addGoRequire(m map[string]string, s string) {
	fields := strings.Fields(s)

	if len(fields) >= 2 {
		m[fields[0]] = fields[1]
	}
}

func addGoReplace(m map[string]goReplace, s string) {
	parts := strings.SplitN(s, "=>", 2)

	if len(parts) != 2 {
		return
	}

	left := strings.Fields(parts[0])
	right := strings.Fields(parts[1])

	if len(left) == 0 || len(right) == 0 {
		return
	}

	if isLocalReplace(right[0]) {
		m[left[0]] = goReplace{local: right[0]}

		return
	}

	rep := goReplace{module: right[0]}

	if len(right) >= 2 {
		rep.version = right[1]
	}

	m[left[0]] = rep
}

func isLocalReplace(p string) bool {
	return strings.HasPrefix(p, "./") || strings.HasPrefix(p, "../") || strings.HasPrefix(p, "/") || p == "."
}

func findGoModule(dir string) (root, modPath string) {
	for {
		if b, err := os.ReadFile(filepath.Join(dir, "go.mod")); err == nil {
			for _, line := range strings.Split(string(b), "\n") {
				line = strings.TrimSpace(line)

				if strings.HasPrefix(line, "module ") {
					return dir, strings.TrimSpace(strings.TrimPrefix(line, "module "))
				}
			}

			return dir, ""
		}

		parent := filepath.Dir(dir)

		if parent == dir {
			return "", ""
		}

		dir = parent
	}
}

// pickGoFile returns a representative .go file in dir — preferring the package-named file,
// else the first non-test .go file. Returns "" if dir has none.
func pickGoFile(dir string) string {
	entries, err := os.ReadDir(dir)

	if err != nil {
		return ""
	}

	preferred := filepath.Base(dir) + ".go"
	fallback := ""

	for _, e := range entries {
		name := e.Name()

		if e.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}

		if name == preferred {
			return filepath.Join(dir, name)
		}

		if fallback == "" {
			fallback = filepath.Join(dir, name)
		}
	}

	return fallback
}

var goDeclRe = regexp.MustCompile(`^(?:func\s+(?:\([^)]*\)\s+)?|type\s+|const\s+|var\s+)([A-Za-z_]\w*)`)

// findGoDecl scans the non-test .go files in dir for a top-level declaration of sym,
// returning the file and its 0-based line. Best-effort (line based).
func findGoDecl(dir, sym string) (string, uint32) {
	entries, err := os.ReadDir(dir)

	if err != nil {
		return "", 0
	}

	for _, e := range entries {
		name := e.Name()

		if e.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}

		file := filepath.Join(dir, name)
		b, err := os.ReadFile(file)

		if err != nil {
			continue
		}

		for i, line := range strings.Split(string(b), "\n") {
			if m := goDeclRe.FindStringSubmatch(line); m != nil && m[1] == sym {
				return file, uint32(i)
			}
		}
	}

	return "", 0
}

// --- JS / TS ---

func analyzeJS(path string, src []byte, lang *sitter.Language) []Link {
	root := parse(lang, src)

	if root == nil {
		return nil
	}

	var out []Link
	nameSpec := map[string]string{} // local identifier → module specifier

	walk(root, func(n *sitter.Node) {
		if n.Type() != "import_statement" {
			return
		}

		srcNode := n.ChildByFieldName("source")

		if srcNode == nil {
			return
		}

		spec := unquote(srcNode.Content(src))
		target := resolveJS(path, spec)

		if target != "" {
			out = append(out, nodeLink(srcNode, target, 0))
		}

		// Record local bindings (default, namespace, named) → spec for usage links.
		walk(n, func(c *sitter.Node) {
			switch c.Type() {
			case "import_specifier":
				if alias := c.ChildByFieldName("alias"); alias != nil {
					nameSpec[alias.Content(src)] = spec
				} else if name := c.ChildByFieldName("name"); name != nil {
					nameSpec[name.Content(src)] = spec
				}

			case "namespace_import", "import_clause":
				if id := firstIdentifier(c, src); id != "" {
					nameSpec[id] = spec
				}
			}
		})
	})

	walk(root, func(n *sitter.Node) {
		if n.Type() != "identifier" || insideImport(n) {
			return
		}

		spec, ok := nameSpec[n.Content(src)]

		if !ok {
			return
		}

		target := resolveJS(path, spec)

		if target == "" {
			return
		}

		line := findDeclLine(target, n.Content(src))
		out = append(out, nodeLink(n, target, line))
	})

	return out
}

func firstIdentifier(n *sitter.Node, src []byte) string {
	for i := 0; i < int(n.NamedChildCount()); i++ {
		c := n.NamedChild(i)

		if c.Type() == "identifier" {
			return c.Content(src)
		}
	}

	return ""
}

func insideImport(n *sitter.Node) bool {
	for p := n.Parent(); p != nil; p = p.Parent() {
		if p.Type() == "import_statement" {
			return true
		}
	}

	return false
}

// resolveJS resolves a module specifier to a file. It handles, in order: relative/absolute
// paths, tsconfig path aliases + baseUrl, and bare packages from node_modules. Returns "".
func resolveJS(from, spec string) string {
	if strings.HasPrefix(spec, ".") || strings.HasPrefix(spec, "/") {
		return resolveJSFile(filepath.Join(filepath.Dir(from), spec))
	}

	if f := resolveJSAlias(from, spec); f != "" {
		return f
	}

	return resolveNodeModule(from, spec)
}

// jsExts are the source extensions tried when resolving a JS/TS module path.
var jsExts = []string{"", ".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mjs", ".cjs", ".vue"}

// resolveJSFile resolves a path with no extension to a real file: it tries the known
// extensions, then an index file inside the directory. Returns "" if nothing exists.
func resolveJSFile(base string) string {
	for _, e := range jsExts {
		if info, err := os.Stat(base + e); err == nil && !info.IsDir() {
			return base + e
		}
	}

	for _, e := range jsExts[1:] {
		idx := filepath.Join(base, "index"+e)

		if info, err := os.Stat(idx); err == nil && !info.IsDir() {
			return idx
		}
	}

	return ""
}

// resolveJSAlias resolves a bare specifier via the nearest tsconfig/jsconfig: first the
// compilerOptions.paths aliases, then a classic baseUrl lookup.
func resolveJSAlias(from, spec string) string {
	cfg := findTSConfig(filepath.Dir(from))

	if cfg == "" {
		return ""
	}

	baseURL, paths := loadTSConfig(cfg, 0)

	if paths != nil {
		if f := matchTSPaths(paths, spec); f != "" {
			return f
		}
	}

	if baseURL != "" {
		if f := resolveJSFile(filepath.Join(baseURL, spec)); f != "" {
			return f
		}
	}

	return ""
}

// tsPaths is a parsed compilerOptions.paths plus the base directory its targets resolve
// against (baseUrl when set, else the config file's directory).
type tsPaths struct {
	base  string
	paths map[string][]string
}

// matchTSPaths resolves spec against the tsconfig paths patterns (supporting a single "*"
// wildcard, like TypeScript), returning the first target that exists on disk.
func matchTSPaths(tp *tsPaths, spec string) string {
	for pattern, targets := range tp.paths {
		star := strings.IndexByte(pattern, '*')

		if star < 0 {
			if pattern != spec {
				continue
			}

			for _, t := range targets {
				if f := resolveJSFile(filepath.Join(tp.base, t)); f != "" {
					return f
				}
			}

			continue
		}

		prefix := pattern[:star]
		suffix := pattern[star+1:]

		if len(spec) < len(prefix)+len(suffix) || !strings.HasPrefix(spec, prefix) || !strings.HasSuffix(spec, suffix) {
			continue
		}

		captured := spec[len(prefix) : len(spec)-len(suffix)]

		for _, t := range targets {
			if f := resolveJSFile(filepath.Join(tp.base, strings.Replace(t, "*", captured, 1))); f != "" {
				return f
			}
		}
	}

	return ""
}

// findTSConfig walks up from dir to the nearest tsconfig.json (or jsconfig.json).
func findTSConfig(dir string) string {
	for {
		for _, name := range []string{"tsconfig.json", "jsconfig.json"} {
			p := filepath.Join(dir, name)

			if info, err := os.Stat(p); err == nil && !info.IsDir() {
				return p
			}
		}

		parent := filepath.Dir(dir)

		if parent == dir {
			return ""
		}

		dir = parent
	}
}

// loadTSConfig parses a tsconfig (JSONC, following `extends`) and returns the effective
// baseUrl (absolute) and paths. Child values override the extended parent's.
func loadTSConfig(path string, depth int) (string, *tsPaths) {
	if depth > 10 {
		return "", nil
	}

	b, err := os.ReadFile(path)

	if err != nil {
		return "", nil
	}

	var raw struct {
		Extends         string `json:"extends"`
		CompilerOptions struct {
			BaseURL string              `json:"baseUrl"`
			Paths   map[string][]string `json:"paths"`
		} `json:"compilerOptions"`
	}

	if json.Unmarshal(stripJSONComments(b), &raw) != nil {
		return "", nil
	}

	dir := filepath.Dir(path)
	baseURL := ""

	var tp *tsPaths

	if raw.Extends != "" && (strings.HasPrefix(raw.Extends, ".") || filepath.IsAbs(raw.Extends)) {
		ext := filepath.Join(dir, raw.Extends)

		if filepath.Ext(ext) == "" {
			ext += ".json"
		}

		baseURL, tp = loadTSConfig(ext, depth+1)
	}

	if raw.CompilerOptions.BaseURL != "" {
		baseURL = filepath.Join(dir, raw.CompilerOptions.BaseURL)
	}

	if len(raw.CompilerOptions.Paths) > 0 {
		base := baseURL

		if base == "" {
			base = dir
		}

		tp = &tsPaths{base: base, paths: raw.CompilerOptions.Paths}
	}

	return baseURL, tp
}

// resolveNodeModule resolves a bare package specifier (optionally with a subpath) by walking
// up the node_modules chain from the importing file.
func resolveNodeModule(from, spec string) string {
	pkg, sub := splitPackageSpec(spec)

	if pkg == "" {
		return ""
	}

	dir := filepath.Dir(from)

	for {
		pkgDir := filepath.Join(dir, "node_modules", pkg)

		if info, err := os.Stat(pkgDir); err == nil && info.IsDir() {
			return resolvePackageFile(pkgDir, sub)
		}

		parent := filepath.Dir(dir)

		if parent == dir {
			return ""
		}

		dir = parent
	}
}

// splitPackageSpec splits a bare specifier into the package name and the subpath, handling
// scoped packages (@scope/name). E.g. "@mantine/core/styles" → ("@mantine/core", "styles").
func splitPackageSpec(spec string) (string, string) {
	parts := strings.Split(spec, "/")

	if strings.HasPrefix(spec, "@") {
		if len(parts) < 2 {
			return "", ""
		}

		return parts[0] + "/" + parts[1], strings.Join(parts[2:], "/")
	}

	return parts[0], strings.Join(parts[1:], "/")
}

// resolvePackageFile resolves a file inside a package dir: a subpath directly, or the
// package entry from package.json (types/typings preferred for go-to-definition, then
// module/main), falling back to index.
func resolvePackageFile(pkgDir, sub string) string {
	if sub != "" {
		return resolveJSFile(filepath.Join(pkgDir, sub))
	}

	pj := readPackageJSON(pkgDir)

	for _, entry := range []string{pj.Types, pj.Typings, pj.Module, pj.Main} {
		if entry == "" {
			continue
		}

		if f := resolveJSFile(filepath.Join(pkgDir, entry)); f != "" {
			return f
		}
	}

	return resolveJSFile(filepath.Join(pkgDir, "index"))
}

type packageJSON struct {
	Main    string `json:"main"`
	Module  string `json:"module"`
	Types   string `json:"types"`
	Typings string `json:"typings"`
}

func readPackageJSON(dir string) packageJSON {
	var pj packageJSON
	b, err := os.ReadFile(filepath.Join(dir, "package.json"))

	if err != nil {
		return pj
	}

	_ = json.Unmarshal(b, &pj)

	return pj
}

// stripJSONComments removes // and /* */ comments and trailing commas so tsconfig's JSONC
// parses as strict JSON. Comment markers inside string literals are preserved.
func stripJSONComments(b []byte) []byte {
	out := make([]byte, 0, len(b))
	inStr := false
	esc := false

	for i := 0; i < len(b); i++ {
		c := b[i]

		if inStr {
			out = append(out, c)

			if esc {
				esc = false
			} else if c == '\\' {
				esc = true
			} else if c == '"' {
				inStr = false
			}

			continue
		}

		if c == '"' {
			inStr = true
			out = append(out, c)

			continue
		}

		if c == '/' && i+1 < len(b) && b[i+1] == '/' {
			for i < len(b) && b[i] != '\n' {
				i++
			}

			if i < len(b) {
				out = append(out, b[i])
			}

			continue
		}

		if c == '/' && i+1 < len(b) && b[i+1] == '*' {
			i += 2

			for i+1 < len(b) && !(b[i] == '*' && b[i+1] == '/') {
				i++
			}

			i++

			continue
		}

		out = append(out, c)
	}

	return removeTrailingCommas(out)
}

// removeTrailingCommas drops a comma that is immediately followed (ignoring whitespace) by
// a closing } or ] — the one JSONC nicety beyond comments that tsconfig files use.
func removeTrailingCommas(b []byte) []byte {
	out := make([]byte, 0, len(b))

	for i := 0; i < len(b); i++ {
		if b[i] == ',' {
			j := i + 1

			for j < len(b) && (b[j] == ' ' || b[j] == '\t' || b[j] == '\n' || b[j] == '\r') {
				j++
			}

			if j < len(b) && (b[j] == '}' || b[j] == ']') {
				continue
			}
		}

		out = append(out, b[i])
	}

	return out
}

var jsDeclRe = regexp.MustCompile(`\b(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)`)

// findDeclLine scans a JS/TS file for a declaration of name, returning its 0-based line.
func findDeclLine(file, name string) uint32 {
	b, err := os.ReadFile(file)

	if err != nil {
		return 0
	}

	for i, line := range strings.Split(string(b), "\n") {
		if m := jsDeclRe.FindStringSubmatch(line); m != nil && m[1] == name {
			return uint32(i)
		}
	}

	return 0
}

func lastSegment(p string) string {
	if i := strings.LastIndex(p, "/"); i >= 0 {
		return p[i+1:]
	}

	return p
}
