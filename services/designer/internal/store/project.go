package store

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"
)

// Project to przeskanowany root (pojedyncza app albo monorepo).
type Project struct {
	ID        int64  `gorm:"primaryKey"`
	Folder    string
	GitPath   string `gorm:"index"`
	Kind      string
	CreatedAt time.Time
}

// UpsertProject zwraca id istniejącego projektu (po git_path, a gdy brak — po
// folderze) aktualizując go, albo wstawia nowy. Re-skan tego samego repo nie
// tworzy duplikatów.
func (s *Store) UpsertProject(ctx context.Context, folder, gitPath, kind string) (int64, error) {
	db := s.db.WithContext(ctx)

	if gitPath != "" {
		var p Project

		err := db.Where("git_path = ?", gitPath).Order("id").First(&p).Error

		if err == nil {
			return p.ID, db.Model(&p).Updates(map[string]any{"folder": folder, "kind": kind}).Error
		}

		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, err
		}
	}

	var p Project

	err := db.Where("git_path = '' AND folder = ?", folder).Order("id").First(&p).Error

	if err == nil {
		return p.ID, db.Model(&p).Update("kind", kind).Error
	}

	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, err
	}

	created := Project{Folder: folder, GitPath: gitPath, Kind: kind}

	if err := db.Create(&created).Error; err != nil {
		return 0, err
	}

	return created.ID, nil
}

// ProjectByID zwraca projekt po id (id == 0 → ostatni przeskanowany).
func (s *Store) ProjectByID(ctx context.Context, id int64) (Project, error) {
	var p Project

	q := s.db.WithContext(ctx)

	if id > 0 {
		return p, q.First(&p, id).Error
	}

	return p, q.Order("id desc").First(&p).Error
}

// ListProjects zwraca wszystkie projekty (najnowsze pierwsze).
func (s *Store) ListProjects(ctx context.Context) ([]Project, error) {
	var ps []Project

	err := s.db.WithContext(ctx).Order("id desc").Find(&ps).Error

	return ps, err
}
