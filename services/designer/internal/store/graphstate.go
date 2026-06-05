package store

import (
	"context"
	"errors"

	"gorm.io/gorm"
)

// GraphState persists per-scene graph UI state (viewport, node positions) as JSON.
type GraphState struct {
	Key  string `gorm:"primaryKey"`
	Data string `gorm:"type:text"`
}

// SaveGraphState upserts the JSON state for a scene key.
func (s *Store) SaveGraphState(ctx context.Context, key, data string) error {
	return s.db.WithContext(ctx).Save(&GraphState{Key: key, Data: data}).Error
}

// GetGraphState returns the JSON state for a key ("" when none).
func (s *Store) GetGraphState(ctx context.Context, key string) (string, error) {
	var g GraphState
	err := s.db.WithContext(ctx).Where("key = ?", key).First(&g).Error

	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", nil
	}

	return g.Data, err
}
