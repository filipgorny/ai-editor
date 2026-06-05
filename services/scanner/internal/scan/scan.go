// Package scan to BEZSTANOWA analiza kodu: wykrywa typ projektu, wylicza
// aplikacje i ekstrahuje encje przez pluginy, a wyniki STRUMIENIUJE jako
// zdarzenia. Nie ma dostępu do bazy — persystencję robi serwis designer.
package scan

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/filipgorny/ai-architect/plugins"
	aiv1 "github.com/filipgorny/ai-architect/proto/ai/v1"
	scannerv1 "github.com/filipgorny/ai-architect/proto/scanner/v1"
	"github.com/filipgorny/ai-architect/services/scanner/internal/detect"
	"github.com/filipgorny/ai-architect/services/scanner/internal/framework"
	"github.com/filipgorny/ai-architect/services/scanner/internal/workspace"
)

// Emit wysyła pojedyncze zdarzenie do klienta (po gRPC stream).
type Emit func(*scannerv1.ScanEvent) error

// Scanner trzyma zależności analizy. LLM idzie WYŁĄCZNIE przez serwis ai.
type Scanner struct {
	resolver      *framework.Resolver
	ai            aiv1.AiClient
	concurrency   int
	maxFiles      int
	describeFiles bool
}

func New(resolver *framework.Resolver, ai aiv1.AiClient, concurrency, maxFiles int, describeFiles bool) *Scanner {
	return &Scanner{
		resolver:      resolver,
		ai:            ai,
		concurrency:   concurrency,
		maxFiles:      maxFiles,
		describeFiles: describeFiles,
	}
}

func (s *Scanner) workers() int {
	if s.concurrency > 0 {
		return s.concurrency
	}

	return runtime.NumCPU()
}

// Run robi skan wierzchni: emituje rozpoznany projekt oraz listę aplikacji
// (dla monorepo wszystkie workspace'y). Bez encji — te robi ScanAppDir.
func (s *Scanner) Run(ctx context.Context, root string, emit Emit) error {
	abs, err := filepath.Abs(root)

	if err != nil {
		return logErr(emit, "zła ścieżka: %v", err)
	}

	if info, err := os.Stat(abs); err != nil || !info.IsDir() {
		return logErr(emit, "katalog nie istnieje: %s", abs)
	}

	logf(emit, scannerv1.Level_INFO, "Skanuję: %s (rdzenie: %d)", abs, runtime.NumCPU())

	kind := detect.Detect(abs)

	if kind == "" {
		logf(emit, scannerv1.Level_WARN, "To nie jest projekt TypeScript ani monorepo — pomijam.")

		return emit(doneEvent(0, 0, 0))
	}

	logf(emit, scannerv1.Level_INFO, "Rozpoznano typ projektu: %s", kind)

	if err := emit(projectEvent(abs, gitRemote(abs), kind)); err != nil {
		return err
	}

	apps := s.listApps(abs, kind)

	logf(emit, scannerv1.Level_INFO, "Aplikacji: %d", len(apps))

	for _, app := range apps {
		res := s.resolver.Resolve(filepath.Join(abs, app.Path))

		if err := emit(appEvent(app, res)); err != nil {
			return err
		}

		logf(emit, scannerv1.Level_INFO, "• %s — framework: %s", app.Name, frameworkOrDash(res.Framework))
	}

	return emit(doneEvent(len(apps), 0, 0))
}

// ScanAppDir robi głęboki skan jednego katalogu aplikacji: ekstrahuje encje
// (moduły/kontrolery/serwisy/komponenty) i je strumieniuje.
func (s *Scanner) ScanAppDir(ctx context.Context, appDir string, emit Emit) error {
	logf(emit, scannerv1.Level_INFO, "Głęboki skan: %s (wątki: %d)", appDir, s.workers())

	all := s.resolver.All()

	if len(all) == 0 {
		logf(emit, scannerv1.Level_WARN, "Brak włączonych pluginów — nic do ekstrakcji")

		return emit(doneEvent(0, 0, 0))
	}

	// Uruchamiamy WSZYSTKIE włączone pluginy i scalamy byty (każdy parsuje
	// swoje pliki — Nest: .ts, React: .tsx). Tagujemy je nazwą pluginu, by
	// designer wiedział, z jakim frameworkiem ma do czynienia.
	var elements []plugins.Element

	for _, plugin := range all {
		part, err := plugin.Extract(ctx, appDir)

		if err != nil {
			logf(emit, scannerv1.Level_WARN, "Plugin %s: %v", plugin.Framework(), err)

			continue
		}

		for i := range part.Elements {
			part.Elements[i].Framework = plugin.Framework()
		}

		elements = append(elements, part.Elements...)

		logf(emit, scannerv1.Level_INFO, "Plugin %s: %d bytów", plugin.Framework(), len(part.Elements))
	}

	count := len(elements)

	for _, el := range elements {
		if err := emit(elementEvent(el)); err != nil {
			return err
		}
	}

	files := 0

	if s.describeFiles && s.ai != nil {
		n, err := s.describeFilesIn(ctx, appDir, emit)

		if err != nil {
			return err
		}

		files = n
	}

	logf(emit, scannerv1.Level_INFO, "Gotowe: %d encji, %d opisów plików", count, files)

	return emit(doneEvent(0, files, count))
}

// fileResult to wynik pracy jednego workera nad jednym plikiem.
type fileResult struct {
	rel  string
	desc string
	err  error
}

// describeFilesIn opisuje pliki kodu serwisu przez LLM — równolegle na rdzeniach,
// emit (stream) serializowany w kolektorze.
func (s *Scanner) describeFilesIn(ctx context.Context, appDir string, emit Emit) (int, error) {
	files := collectCodeFiles(appDir)

	if s.maxFiles > 0 && len(files) > s.maxFiles {
		files = files[:s.maxFiles]
	}

	if len(files) == 0 {
		return 0, nil
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	workers := s.workers()

	if workers > len(files) {
		workers = len(files)
	}

	jobs := make(chan string)
	results := make(chan fileResult)

	var wg sync.WaitGroup

	for i := 0; i < workers; i++ {
		wg.Add(1)

		go func() {
			defer wg.Done()

			for path := range jobs {
				rel := relPath(appDir, path)

				resp, err := s.ai.Generate(ctx, &aiv1.GenerateRequest{
					System:      "Jesteś doświadczonym inżynierem. Opisz krótko (1-2 zdania) co robi plik. Odpowiedz samym opisem.",
					Prompt:      fmt.Sprintf("Plik: %s\n\nKod:\n%s", rel, readTruncated(path)),
					Temperature: 0.1,
					MaxTokens:   160,
				})

				desc := ""

				if resp != nil {
					desc = resp.GetText()
				}

				results <- fileResult{rel: rel, desc: desc, err: err}
			}
		}()
	}

	go func() {
		defer close(jobs)

		for _, f := range files {
			select {
			case <-ctx.Done():
				return

			case jobs <- f:
			}
		}
	}()

	go func() {
		wg.Wait()
		close(results)
	}()

	count := 0
	var emitErr error

	for r := range results {
		if emitErr != nil {
			continue
		}

		if r.err != nil {
			logf(emit, scannerv1.Level_ERROR, "  błąd LLM dla %s: %v", r.rel, r.err)

			continue
		}

		count++
		logf(emit, scannerv1.Level_INFO, "  ✓ %s — %s", r.rel, firstLine(r.desc))

		if err := emit(fileEvent(r.rel, r.desc)); err != nil {
			emitErr = err

			cancel()
		}
	}

	return count, emitErr
}

func (s *Scanner) listApps(root, kind string) []workspace.App {
	if kind == "monorepo" {
		if apps := workspace.Apps(root); len(apps) > 0 {
			return apps
		}
	}

	return []workspace.App{{Name: filepath.Base(root), Path: "."}}
}

func gitRemote(dir string) string {
	if out, err := exec.Command("git", "-C", dir, "config", "--get", "remote.origin.url").Output(); err == nil {
		if v := strings.TrimSpace(string(out)); v != "" {
			return v
		}
	}

	if out, err := exec.Command("git", "-C", dir, "rev-parse", "--show-toplevel").Output(); err == nil {
		return strings.TrimSpace(string(out))
	}

	return ""
}

func frameworkOrDash(f string) string {
	if f == "" {
		return "nierozpoznany"
	}

	return f
}
