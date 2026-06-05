package store

import (
	"context"
	"time"
)

// File to plik z opisem wygenerowanym przez LLM.
type File struct {
	ID          int64  `gorm:"primaryKey"`
	AppID       int64  `gorm:"index"`
	Path        string
	Description string
	CreatedAt   time.Time
}

func (s *Store) InsertFile(ctx context.Context, appID int64, path, description string) error {
	return s.db.WithContext(ctx).Create(&File{
		AppID:       appID,
		Path:        path,
		Description: description,
	}).Error
}
