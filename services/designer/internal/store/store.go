// Package store to jedyny w systemie dostęp do bazy (designer), oparty na GORM.
// Każda encja ma własny plik (model + operacje). Tu żyje rdzeń: połączenie,
// migracja schematu, czyszczenie i wspólne helpery.
package store

import (
	"context"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Store opakowuje połączenie GORM.
type Store struct {
	db *gorm.DB
}

// New otwiera połączenie i migruje schemat (AutoMigrate).
func New(dsn string) (*Store, error) {
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})

	if err != nil {
		return nil, err
	}

	if err := db.AutoMigrate(&Project{}, &App{}, &Element{}, &File{}); err != nil {
		return nil, err
	}

	return &Store{db: db}, nil
}

// DB udostępnia uchwyt GORM (np. dla buildera grafu).
func (s *Store) DB() *gorm.DB {
	return s.db
}

// Close zamyka pulę połączeń.
func (s *Store) Close() {
	if sqlDB, err := s.db.DB(); err == nil {
		_ = sqlDB.Close()
	}
}

// ClearAppEntities usuwa wcześniejsze encje i pliki aplikacji (idempotentny re-skan).
func (s *Store) ClearAppEntities(ctx context.Context, appID int64) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, model := range []any{&Element{}, &File{}} {
			if err := tx.Where("app_id = ?", appID).Delete(model).Error; err != nil {
				return err
			}
		}

		return nil
	})
}
