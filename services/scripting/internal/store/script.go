package store

import (
	"context"
	"time"
)

// Script is a user script: name + content + optional project. CreatedAt/UpdatedAt
// (unix seconds) are auto-filled by GORM for fields with those names of type int64.
type Script struct {
	ID        int64  `gorm:"primaryKey"`
	Name      string `gorm:"type:text"`
	Content   string `gorm:"type:text"`
	Project   string `gorm:"type:text;index"` // project folder ("" = global)
	CreatedAt int64
	UpdatedAt int64
}

// List returns scripts matching the project filter: project == "" → all; otherwise global
// ones (project == "") plus those pinned to this project. Newest first.
func (s *Store) List(ctx context.Context, project string) ([]Script, error) {
	var rows []Script
	q := s.db.WithContext(ctx).Order("updated_at desc, id desc")

	if project != "" {
		q = q.Where("project = ? OR project = ''", project)
	}

	err := q.Find(&rows).Error

	return rows, err
}

// Get returns a script by id.
func (s *Store) Get(ctx context.Context, id int64) (*Script, error) {
	var sc Script

	if err := s.db.WithContext(ctx).First(&sc, id).Error; err != nil {
		return nil, err
	}

	return &sc, nil
}

// Save creates (id == 0) or updates a script; on update it keeps CreatedAt and bumps
// UpdatedAt. Returns the saved record.
func (s *Store) Save(ctx context.Context, in *Script) (*Script, error) {
	if in.ID == 0 {
		if err := s.db.WithContext(ctx).Create(in).Error; err != nil {
			return nil, err
		}

		return in, nil
	}

	now := time.Now().Unix()
	err := s.db.WithContext(ctx).Model(&Script{}).Where("id = ?", in.ID).
		Updates(map[string]any{"name": in.Name, "content": in.Content, "project": in.Project, "updated_at": now}).Error

	if err != nil {
		return nil, err
	}

	return s.Get(ctx, in.ID)
}

// Delete removes a script by id.
func (s *Store) Delete(ctx context.Context, id int64) error {
	return s.db.WithContext(ctx).Delete(&Script{}, id).Error
}
