// Package server implementuje serwis git — autorstwo plików i diff-review. Operuje
// BEZPOŚREDNIO na repozytorium projektu na dysku (git -C <repo>), dzięki czemu widzi
// też NIEzacommitowane zmiany w drzewie roboczym (czego sama kopia .git nie pokazuje).
// UploadRepo zostaje dla kompatybilności (gdy dysk repo jest niedostępny), ale zapytania
// preferują realne repo. Gateway pośredniczy.
package server

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	gitv1 "github.com/filipgorny/ai-architect/proto/git/v1"
)

type Server struct {
	gitv1.UnimplementedGitServer

	// base — katalog na wgrane kopie .git (fallback, gdy realne repo niedostępne).
	base string
}

func New(base string) *Server {
	if base == "" {
		base = filepath.Join(os.TempDir(), "ai-architect-git")
	}

	return &Server{base: base}
}

// repoGit uruchamia `git -C <repo>` na realnym repozytorium projektu (widzi też
// drzewo robocze: zmiany niezacommitowane i pliki nieśledzone).
func (s *Server) repoGit(ctx context.Context, repo string, args ...string) (string, error) {
	// safe.directory=* — repo zamontowane w kontenerze ma inny właściciel niż proces;
	// bez tego git odmawia ("detected dubious ownership"). Natywnie nieszkodliwe.
	full := append([]string{"-C", repo, "-c", "core.quotePath=false", "-c", "safe.directory=*"}, args...)

	return run(ctx, full)
}

func run(ctx context.Context, args []string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	var out, errb bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errb

	err := cmd.Run()

	return out.String(), err
}

// FileInfo zwraca autora ostatniego commitu dotykającego pliku.
func (s *Server) FileInfo(ctx context.Context, req *gitv1.FileInfoRequest) (*gitv1.FileInfoResponse, error) {
	repo := req.GetRepoPath()
	rel := relPath(repo, req.GetFile())

	out, err := s.repoGit(ctx, repo, "log", "-1", "--format=%an%x1f%ae%x1f%H%x1f%ct%x1f%s", "--", rel)

	if err != nil || strings.TrimSpace(out) == "" {
		return &gitv1.FileInfoResponse{Tracked: false}, nil
	}

	parts := strings.SplitN(strings.TrimRight(out, "\n"), "\x1f", 5)

	if len(parts) < 5 {
		return &gitv1.FileInfoResponse{Tracked: false}, nil
	}

	ts, _ := strconv.ParseInt(parts[3], 10, 64)

	return &gitv1.FileInfoResponse{
		Tracked:         true,
		LastAuthor:      parts[0],
		LastAuthorEmail: parts[1],
		LastCommitHash:  parts[2],
		LastCommitTime:  ts,
		LastMessage:     parts[4],
	}, nil
}

// ReviewStatus zwraca pliki do recenzji. Najpierw NIEzacommitowane zmiany drzewa
// roboczego (git status — to zwykle to, co chce zobaczyć użytkownik); gdy drzewo
// czyste, schodzi do różnicy bieżącej gałęzi względem bazowej (review gałęzi).
func (s *Server) ReviewStatus(ctx context.Context, req *gitv1.ReviewRequest) (*gitv1.ReviewStatusResponse, error) {
	repo := req.GetRepoPath()
	head, _ := s.repoGit(ctx, repo, "symbolic-ref", "--short", "HEAD")
	resp := &gitv1.ReviewStatusResponse{Head: strings.TrimSpace(head)}

	if files := s.worktreeChanges(ctx, repo); len(files) > 0 {
		resp.Base = "HEAD"
		resp.Files = files

		return resp, nil
	}

	base, mergeBase := s.detectBase(ctx, repo, req.GetBase())
	resp.Base = base

	if mergeBase == "" {
		return resp, nil
	}

	out, err := s.repoGit(ctx, repo, "diff", "--name-status", "-M", mergeBase, "HEAD")

	if err != nil {
		return resp, nil
	}

	for _, line := range strings.Split(out, "\n") {
		fields := strings.Split(strings.TrimRight(line, "\r"), "\t")

		if len(fields) < 2 || fields[0] == "" {
			continue
		}

		path := fields[len(fields)-1] // rename/copy: ostatnie pole = nowa ścieżka

		resp.Files = append(resp.Files, &gitv1.ChangedFile{
			Path:    path,
			AbsPath: filepath.Join(repo, path),
			Status:  statusOf(fields[0]),
		})
	}

	return resp, nil
}

// worktreeChanges parsuje `git status --porcelain` (zmiany niezacommitowane:
// zmodyfikowane, dodane do indeksu i NIEŚLEDZONE pliki).
func (s *Server) worktreeChanges(ctx context.Context, repo string) []*gitv1.ChangedFile {
	out, err := s.repoGit(ctx, repo, "status", "--porcelain")

	if err != nil {
		return nil
	}

	var files []*gitv1.ChangedFile

	for _, line := range strings.Split(out, "\n") {
		if len(line) < 4 {
			continue
		}

		code := line[:2]
		rest := line[3:]
		path := rest

		// rename w porcelain: "R  stara -> nowa" → bierzemy nową ścieżkę.
		if i := strings.Index(rest, " -> "); i >= 0 {
			path = rest[i+4:]
		}

		files = append(files, &gitv1.ChangedFile{
			Path:    path,
			AbsPath: filepath.Join(repo, path),
			Status:  worktreeStatus(code),
		})
	}

	return files
}

var hunkRe = regexp.MustCompile(`^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@`)

// FileDiff zwraca numery linii dodanych i zmienionych w pliku — preferując zmiany
// niezacommitowane (vs HEAD); gdy ich brak, różnicę względem gałęzi bazowej.
func (s *Server) FileDiff(ctx context.Context, req *gitv1.FileDiffRequest) (*gitv1.FileDiffResponse, error) {
	repo := req.GetRepoPath()
	rel := relPath(repo, req.GetFile())
	abs := req.GetFile()

	if !filepath.IsAbs(abs) {
		abs = filepath.Join(repo, rel)
	}

	resp := &gitv1.FileDiffResponse{Status: "unchanged"}

	// Plik nieśledzony (całkiem nowy) → wszystkie linie na zielono.
	if _, err := s.repoGit(ctx, repo, "ls-files", "--error-unmatch", "--", rel); err != nil {
		n := countLines(abs)
		resp.Status = "new"

		for i := 1; i <= n; i++ {
			resp.AddedLines = append(resp.AddedLines, int32(i))
		}

		return resp, nil
	}

	// Śledzony → najpierw diff niezacommitowany (vs HEAD), potem fallback: gałąź vs baza.
	diff, _ := s.repoGit(ctx, repo, "diff", "--unified=0", "--no-color", "HEAD", "--", rel)
	cmpBase := ""

	if strings.TrimSpace(diff) == "" {
		if _, mb := s.detectBase(ctx, repo, req.GetBase()); mb != "" {
			diff, _ = s.repoGit(ctx, repo, "diff", "--unified=0", "--no-color", "-M", mb, "HEAD", "--", rel)
			cmpBase = mb
		}
	}

	if strings.TrimSpace(diff) == "" {
		return resp, nil
	}

	resp.Status = "modified"
	statusArgs := []string{"diff", "--name-status", "HEAD", "--", rel}

	if cmpBase != "" {
		statusArgs = []string{"diff", "--name-status", "-M", cmpBase, "HEAD", "--", rel}
	}

	if st, err := s.repoGit(ctx, repo, statusArgs...); err == nil {
		if f := strings.Fields(strings.TrimSpace(st)); len(f) >= 1 && f[0] != "" {
			resp.Status = statusOf(f[0])
		}
	}

	parseDiffLines(diff, resp)

	return resp, nil
}

// parseDiffLines wypełnia AddedLines/ModifiedLines na podstawie diffa --unified=0.
// Linie dodane w hunku bez usunięć → nowe (zielone); z usunięciami → zmienione (żółte).
func parseDiffLines(diff string, resp *gitv1.FileDiffResponse) {
	newLine := 0
	removalInHunk := false
	isNew := resp.Status == "new"

	for _, line := range strings.Split(diff, "\n") {
		if m := hunkRe.FindStringSubmatch(line); m != nil {
			oldCount := 1

			if m[2] != "" {
				oldCount, _ = strconv.Atoi(m[2])
			}

			newLine, _ = strconv.Atoi(m[3])
			removalInHunk = oldCount > 0

			continue
		}

		if strings.HasPrefix(line, "+++") || strings.HasPrefix(line, "---") {
			continue
		}

		if strings.HasPrefix(line, "+") {
			if isNew || !removalInHunk {
				resp.AddedLines = append(resp.AddedLines, int32(newLine))
			} else {
				resp.ModifiedLines = append(resp.ModifiedLines, int32(newLine))
			}

			newLine++
		}
	}
}

// detectBase wybiera gałąź bazową (main/master/…) różną od bieżącej i liczy
// merge-base z HEAD. Zwraca ("","") gdy brak sensownej bazy (np. jesteśmy na mainie).
func (s *Server) detectBase(ctx context.Context, repo, override string) (string, string) {
	candidates := []string{"main", "master", "develop", "trunk"}

	if override != "" {
		candidates = []string{override}
	}

	current := ""

	if out, err := s.repoGit(ctx, repo, "symbolic-ref", "--short", "HEAD"); err == nil {
		current = strings.TrimSpace(out)
	}

	for _, cand := range candidates {
		if cand == current {
			continue
		}

		if _, err := s.repoGit(ctx, repo, "rev-parse", "--verify", "--quiet", cand+"^{commit}"); err != nil {
			continue
		}

		mb, err := s.repoGit(ctx, repo, "merge-base", cand, "HEAD")

		if err != nil {
			return cand, strings.TrimSpace(cand)
		}

		return cand, strings.TrimSpace(mb)
	}

	return "", ""
}

// --- UploadRepo: zapis wgranej kopii .git (fallback dla repo bez dostępu do dysku) ---

func (s *Server) gitDirFor(repoPath string) string {
	sum := sha1.Sum([]byte(repoPath))

	return filepath.Join(s.base, hex.EncodeToString(sum[:]), ".git")
}

// UploadRepo odbiera strumień kawałków .git i odtwarza katalog u siebie. Obecnie
// zapytania operują na realnym repo (git -C), więc upload jest pomocniczy.
func (s *Server) UploadRepo(stream gitv1.Git_UploadRepoServer) error {
	open := map[string]*os.File{}
	wiped := map[string]string{}
	var repoPath string
	files := 0

	defer func() {
		for _, f := range open {
			_ = f.Close()
		}
	}()

	for {
		chunk, err := stream.Recv()

		if err == io.EOF {
			break
		}

		if err != nil {
			return err
		}

		repoPath = chunk.GetRepoPath()
		gitDir, ok := wiped[repoPath]

		if !ok {
			gitDir = s.gitDirFor(repoPath)

			if rerr := os.RemoveAll(gitDir); rerr != nil {
				return rerr
			}

			wiped[repoPath] = gitDir
		}

		rel := safeRel(chunk.GetRelPath())

		if rel == "" {
			continue
		}

		f := open[rel]

		if f == nil {
			dst := filepath.Join(gitDir, rel)

			if merr := os.MkdirAll(filepath.Dir(dst), 0o755); merr != nil {
				return merr
			}

			nf, oerr := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)

			if oerr != nil {
				return oerr
			}

			f = nf
			open[rel] = f
			files++
		}

		if _, werr := f.Write(chunk.GetData()); werr != nil {
			return werr
		}

		if chunk.GetEof() {
			_ = f.Close()
			delete(open, rel)
		}
	}

	head := ""

	if repoPath != "" {
		if out, err := run(stream.Context(), []string{"--git-dir=" + s.gitDirFor(repoPath), "symbolic-ref", "--short", "HEAD"}); err == nil {
			head = strings.TrimSpace(out)
		}
	}

	return stream.SendAndClose(&gitv1.UploadResult{
		RepoPath:   repoPath,
		Ok:         true,
		Files:      int32(files),
		HeadBranch: head,
	})
}

// statusOf mapuje kod git name-status (A/M/D/R/…) na nasz status węzła.
func statusOf(code string) string {
	switch code[0] {
	case 'A':
		return "new"

	case 'D':
		return "deleted"

	case 'R':
		return "renamed"

	default: // M, C, T, …
		return "modified"
	}
}

// worktreeStatus mapuje 2-znakowy kod `git status --porcelain` (XY) na nasz status.
func worktreeStatus(code string) string {
	switch {
	case code == "??" || strings.Contains(code, "A"):
		return "new"

	case strings.Contains(code, "R"):
		return "renamed"

	case strings.Contains(code, "D"):
		return "deleted"

	default:
		return "modified"
	}
}

// countLines zlicza linie pliku (do oznaczenia całego nowego pliku jako dodanego).
func countLines(abs string) int {
	data, err := os.ReadFile(abs)

	if err != nil || len(data) == 0 {
		return 0
	}

	n := bytes.Count(data, []byte("\n"))

	if data[len(data)-1] != '\n' {
		n++ // ostatnia linia bez końcowego \n
	}

	return n
}

// relPath zwraca ścieżkę pliku względną do repo (git operuje na ścieżkach repo).
func relPath(repoPath, file string) string {
	rel := file

	if filepath.IsAbs(file) && repoPath != "" {
		if r, err := filepath.Rel(repoPath, file); err == nil {
			rel = r
		}
	}

	return filepath.ToSlash(rel)
}

// safeRel czyści ścieżkę z .git i odrzuca próby wyjścia poza katalog (path traversal).
func safeRel(rel string) string {
	clean := filepath.Clean("/" + filepath.ToSlash(rel))
	clean = strings.TrimPrefix(clean, "/")

	if clean == "" || clean == "." || strings.HasPrefix(clean, "..") {
		return ""
	}

	return clean
}
