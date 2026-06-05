package server

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/fsnotify/fsnotify"

	filerv1 "github.com/filipgorny/ai-architect/proto/filer/v1"
)

// skipDir lists directory names that never carry meaningful graph changes and
// would otherwise flood the watcher (and exhaust inotify watches).
var skipDir = map[string]bool{
	"node_modules": true,
	".git":         true,
	"dist":         true,
	"build":        true,
	"out":          true,
	".next":        true,
	"vendor":       true,
	"target":       true,
	".cache":       true,
	".idea":        true,
	".vscode":      true,
}

func ignored(path string) bool {
	for _, seg := range strings.Split(path, string(os.PathSeparator)) {
		if skipDir[seg] || strings.HasPrefix(seg, "bazel-") {
			return true
		}
	}

	return false
}

// Watch observes the directory tree recursively and streams change events so the
// UI graph can react to files appearing/disappearing on disk. Blocks until the
// client cancels the stream (ctx.Done) or the watcher fails.
func (s *Server) Watch(req *filerv1.PathReq, stream filerv1.Filer_WatchServer) error {
	root := req.GetPath()

	w, err := fsnotify.NewWatcher()

	if err != nil {
		return err
	}

	defer w.Close()

	// Add the root and every (non-ignored) subdirectory — fsnotify is not recursive.
	addTree(w, root)

	ctx := stream.Context()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()

		case err, ok := <-w.Errors:
			if !ok {
				return nil
			}

			_ = err // best effort: keep streaming despite transient watcher errors

		case ev, ok := <-w.Events:
			if !ok {
				return nil
			}

			if ignored(ev.Name) {
				continue
			}

			info, statErr := os.Stat(ev.Name)
			isDir := statErr == nil && info.IsDir()

			// A newly created directory must be watched too (its children won't
			// emit events otherwise).
			if isDir && ev.Op&fsnotify.Create != 0 {
				addTree(w, ev.Name)
			}

			if err := stream.Send(&filerv1.FileEvent{
				Path: ev.Name,
				Op:   opName(ev.Op),
				Dir:  isDir,
			}); err != nil {
				return err
			}
		}
	}
}

// addTree walks dir and registers every non-ignored directory with the watcher.
func addTree(w *fsnotify.Watcher, dir string) {
	_ = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil || !d.IsDir() {
			return nil
		}

		if ignored(path) {
			return filepath.SkipDir
		}

		_ = w.Add(path)

		return nil
	})
}

func opName(op fsnotify.Op) string {
	switch {
	case op&fsnotify.Create != 0:
		return "create"

	case op&fsnotify.Write != 0:
		return "write"

	case op&fsnotify.Remove != 0:
		return "remove"

	case op&fsnotify.Rename != 0:
		return "rename"

	default:
		return "chmod"
	}
}
