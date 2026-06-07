package store

import (
	"context"
	"errors"
	"path/filepath"
	"time"

	"gorm.io/gorm"
)

// App to aplikacja/serwis (root przy pojedynczej app, albo workspace monorepo). Language i
// Kind pochodzą z klasyfikatorów scannera (język + framework + app/package).
type App struct {
	ID        int64  `gorm:"primaryKey"`
	ProjectID int64  `gorm:"index"`
	Name      string
	Path      string
	Framework string
	Language  string
	Kind      string // "app" | "package"
	HasPlugin bool
	CreatedAt time.Time
}

// UpsertApp zwraca id istniejącej aplikacji (po project_id + path) aktualizując
// ją, albo wstawia nową — zachowując id i wcześniej wyekstrahowane encje.
func (s *Store) UpsertApp(ctx context.Context, projectID int64, name, path, framework, language, kind string, hasPlugin bool) (int64, error) {
	db := s.db.WithContext(ctx)

	var a App

	err := db.Where("project_id = ? AND path = ?", projectID, path).First(&a).Error

	if err == nil {
		return a.ID, db.Model(&a).Updates(map[string]any{
			"name": name, "framework": framework, "language": language, "kind": kind, "has_plugin": hasPlugin,
		}).Error
	}

	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, err
	}

	created := App{ProjectID: projectID, Name: name, Path: path, Framework: framework, Language: language, Kind: kind, HasPlugin: hasPlugin}

	if err := db.Create(&created).Error; err != nil {
		return 0, err
	}

	return created.ID, nil
}

// AppsByProject zwraca aplikacje projektu (alfabetycznie).
func (s *Store) AppsByProject(ctx context.Context, projectID int64) ([]App, error) {
	var apps []App

	err := s.db.WithContext(ctx).Where("project_id = ?", projectID).Order("name").Find(&apps).Error

	return apps, err
}

// PruneApps usuwa aplikacje projektu, których ścieżki NIE ma w keepPaths (czyli te,
// których ostatni skan już nie wykrył) — wraz z ich encjami i opisami plików. Dzięki temu
// nieaktualne węzły (np. błędnie rozpoznany kiedyś folder) znikają po ponownym skanie.
func (s *Store) PruneApps(ctx context.Context, projectID int64, keepPaths []string) error {
	db := s.db.WithContext(ctx)

	q := db.Where("project_id = ?", projectID)

	if len(keepPaths) > 0 {
		q = q.Where("path NOT IN ?", keepPaths)
	}

	var stale []App

	if err := q.Find(&stale).Error; err != nil {
		return err
	}

	for _, a := range stale {
		if err := s.ClearAppEntities(ctx, a.ID); err != nil {
			return err
		}

		if err := db.Delete(&App{}, a.ID).Error; err != nil {
			return err
		}
	}

	return nil
}

// FirstAppID zwraca id pierwszej aplikacji projektu (dla pojedynczej app).
func (s *Store) FirstAppID(ctx context.Context, projectID int64) (int64, error) {
	var a App

	err := s.db.WithContext(ctx).Where("project_id = ?", projectID).Order("id").First(&a).Error

	return a.ID, err
}

// AppDir zwraca absolutną ścieżkę katalogu aplikacji (folder projektu + path).
func (s *Store) AppDir(ctx context.Context, appID int64) (string, error) {
	var a App

	if err := s.db.WithContext(ctx).First(&a, appID).Error; err != nil {
		return "", err
	}

	var p Project

	if err := s.db.WithContext(ctx).First(&p, a.ProjectID).Error; err != nil {
		return "", err
	}

	return filepath.Join(p.Folder, a.Path), nil
}
