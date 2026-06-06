// Package protobuf to plugin modeli Protobuf. Rozpoznaje katalogi z plikami
// .proto i ekstrahuje definicje jako byty grafu: message/enum jako "class"
// (z polami w roli funkcji), service jako "service" (z metodami rpc). Dzięki
// temu modele można przeglądać i zarządzać nimi jak resztą encji.
package protobuf

import (
	"context"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/filipgorny/ai-architect/plugins"
)

func init() {
	plugins.Register(&Plugin{})
}

// Plugin implementuje plugins.Plugin dla Protobuf.
type Plugin struct{}

func (p *Plugin) Framework() string {
	return "protobuf"
}

// Detect uznaje katalog za protobufowy, gdy zawiera jakikolwiek plik .proto.
func (p *Plugin) Detect(appDir string) bool {
	return hasProtoFiles(appDir)
}

// Extract parsuje pliki .proto i zbiera message/enum/service.
func (p *Plugin) Extract(_ context.Context, appDir string) (*plugins.Entities, error) {
	out := &plugins.Entities{}

	for _, path := range collectProtoFiles(appDir) {
		out.Elements = append(out.Elements, parseProto(appDir, path)...)
	}

	return out, nil
}

var (
	blockComment = regexp.MustCompile(`(?s)/\*.*?\*/`)
	declRe       = regexp.MustCompile(`^\s*(message|enum|service)\s+([A-Za-z_]\w*)`)
	rpcRe        = regexp.MustCompile(`^\s*rpc\s+([A-Za-z_]\w*)`)
	fieldRe      = regexp.MustCompile(`([A-Za-z_]\w*)\s*=\s*\d+`)
)

// frame to otwarty kontener (message/enum/service) wraz z głębokością klamr,
// na której się otworzył — pozwala poprawnie domknąć zagnieżdżenia.
type frame struct {
	idx       int
	kind      string
	openDepth int
}

// parseProto zwraca byty z jednego pliku .proto. Parser jest liniowo-klamrowy:
// śledzi głębokość `{}`, a pola/wartości/rpc dokleja do najbliższego kontenera.
func parseProto(appDir, path string) []plugins.Element {
	data, err := os.ReadFile(path)

	if err != nil {
		return nil
	}

	text := blockComment.ReplaceAllString(string(data), "")
	rel := relPath(appDir, path)

	var els []plugins.Element
	var stack []frame
	depth := 0

	for _, raw := range strings.Split(text, "\n") {
		line := raw

		if i := strings.Index(line, "//"); i >= 0 {
			line = line[:i]
		}

		if strings.TrimSpace(line) == "" {
			continue
		}

		if m := declRe.FindStringSubmatch(line); m != nil {
			els = append(els, plugins.Element{Kind: protoKind(m[1]), Name: m[2], File: rel})
			stack = append(stack, frame{idx: len(els) - 1, kind: m[1], openDepth: depth})
		} else if top := current(stack); top != nil {
			collectMember(&els[top.idx], top.kind, line)
		}

		depth += strings.Count(line, "{") - strings.Count(line, "}")

		for len(stack) > 0 && depth <= stack[len(stack)-1].openDepth {
			stack = stack[:len(stack)-1]
		}
	}

	return els
}

// collectMember dokleja jeden składnik (pole message, wartość enum albo rpc
// service) do bieżącego bytu jako wpis Functions.
func collectMember(el *plugins.Element, kind, line string) {
	if kind == "service" {
		if m := rpcRe.FindStringSubmatch(line); m != nil {
			el.Functions = append(el.Functions, m[1])
		}

		return
	}

	// message/enum: identyfikator tuż przed `= <numer>` to nazwa pola/wartości.
	if m := fieldRe.FindStringSubmatch(line); m != nil {
		el.Functions = append(el.Functions, m[1])
	}
}

// protoKind mapuje słowo kluczowe proto na rodzaj bytu grafu.
func protoKind(keyword string) string {
	if keyword == "service" {
		return "service"
	}

	return "class"
}

func current(stack []frame) *frame {
	if len(stack) == 0 {
		return nil
	}

	return &stack[len(stack)-1]
}

// --- pomocnicze: pliki ---

func collectProtoFiles(appDir string) []string {
	var files []string

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

		if strings.HasSuffix(d.Name(), ".proto") {
			files = append(files, path)
		}

		return nil
	})

	return files
}

func hasProtoFiles(appDir string) bool {
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

		if strings.HasSuffix(d.Name(), ".proto") {
			found = true

			return filepath.SkipAll
		}

		return nil
	})

	return found
}

func skipDir(name string) bool {
	switch name {
	case "node_modules", "dist", "build", "out", "vendor", ".git":
		return true
	}

	return strings.HasPrefix(name, ".")
}

func relPath(root, path string) string {
	rel, err := filepath.Rel(root, path)

	if err != nil {
		return path
	}

	return rel
}
