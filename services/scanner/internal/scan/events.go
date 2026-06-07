package scan

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/filipgorny/ai-architect/plugins"
	scannerv1 "github.com/filipgorny/ai-architect/proto/scanner/v1"
	"github.com/filipgorny/ai-architect/services/scanner/internal/classifiers"
	"github.com/filipgorny/ai-architect/services/scanner/internal/workspace"
)

// Encje emitowane bez identyfikatorów z bazy — id nadaje serwis designer.

func logf(emit Emit, level scannerv1.Level, format string, args ...any) {
	_ = emit(&scannerv1.ScanEvent{
		Event: &scannerv1.ScanEvent_Log{
			Log: &scannerv1.LogLine{Level: level, Message: fmt.Sprintf(format, args...)},
		},
	})
}

func logErr(emit Emit, format string, args ...any) error {
	msg := fmt.Sprintf(format, args...)

	logf(emit, scannerv1.Level_ERROR, "%s", msg)

	return fmt.Errorf("%s", msg)
}

func projectEvent(folder, gitPath, kind string) *scannerv1.ScanEvent {
	return &scannerv1.ScanEvent{
		Event: &scannerv1.ScanEvent_Project{
			Project: &scannerv1.ProjectDetected{Folder: folder, GitPath: gitPath, Kind: kind},
		},
	}
}

func appEvent(app workspace.App, cls classifiers.Result, hasPlugin bool) *scannerv1.ScanEvent {
	return &scannerv1.ScanEvent{
		Event: &scannerv1.ScanEvent_App{
			App: &scannerv1.AppDetected{
				Name:      app.Name,
				Path:      app.Path,
				Framework: cls.Framework,
				Language:  cls.Language,
				Kind:      cls.Kind,
				HasPlugin: hasPlugin,
			},
		},
	}
}

func elementEvent(e plugins.Element) *scannerv1.ScanEvent {
	links := make([]*scannerv1.Link, 0, len(e.Links))

	for _, l := range e.Links {
		links = append(links, &scannerv1.Link{Target: l.Target, Label: l.Label})
	}

	return &scannerv1.ScanEvent{
		Event: &scannerv1.ScanEvent_Element{
			Element: &scannerv1.Element{
				Framework: e.Framework,
				Kind:      e.Kind,
				Name:      e.Name,
				File:      e.File,
				Route:     e.Route,
				Functions: e.Functions,
				Links:     links,
			},
		},
	}
}

func fileEvent(path, desc string) *scannerv1.ScanEvent {
	return &scannerv1.ScanEvent{
		Event: &scannerv1.ScanEvent_File{
			File: &scannerv1.FileDescribed{Path: path, Description: desc},
		},
	}
}

func doneEvent(apps, files, entities int) *scannerv1.ScanEvent {
	return &scannerv1.ScanEvent{
		Event: &scannerv1.ScanEvent_Done{
			Done: &scannerv1.ScanDone{
				AppsScanned:     int32(apps),
				FilesScanned:    int32(files),
				EntitiesScanned: int32(entities),
			},
		},
	}
}

// --- util plikowy (opis plików) ---

var codeExt = map[string]bool{
	".ts": true, ".tsx": true, ".js": true, ".jsx": true, ".mjs": true, ".cjs": true,
	".go": true, ".json": true, ".md": true, ".css": true, ".scss": true,
	".html": true, ".vue": true, ".svelte": true, ".yaml": true, ".yml": true,
}

var skipFiles = map[string]bool{
	"package-lock.json": true, "pnpm-lock.yaml": true, "yarn.lock": true, "bun.lockb": true,
}

func collectCodeFiles(appDir string) []string {
	var files []string

	_ = filepath.WalkDir(appDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}

		if d.IsDir() {
			if path != appDir && skipDir(d.Name()) {
				return filepath.SkipDir
			}

			return nil
		}

		if isCodeFile(d.Name()) {
			files = append(files, path)
		}

		return nil
	})

	return files
}

func isCodeFile(name string) bool {
	if skipFiles[name] {
		return false
	}

	if strings.HasSuffix(name, ".d.ts") || strings.HasSuffix(name, ".min.js") {
		return false
	}

	return codeExt[ext(name)]
}

func skipDir(name string) bool {
	switch name {
	case "node_modules", "dist", "build", "out", "coverage", "vendor", ".git":
		return true
	}

	return strings.HasPrefix(name, ".")
}

func ext(name string) string {
	i := strings.LastIndex(name, ".")

	if i < 0 {
		return ""
	}

	return name[i:]
}

func relPath(root, path string) string {
	if rel, err := filepath.Rel(root, path); err == nil {
		return rel
	}

	return path
}

func readTruncated(path string) string {
	const max = 8000

	data, err := os.ReadFile(path)

	if err != nil {
		return ""
	}

	if len(data) > max {
		data = data[:max]
	}

	return string(data)
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)

	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}

	return s
}
