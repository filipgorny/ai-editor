// Package store is the logs service's database access (Postgres, GORM). It holds the app's log
// lines. Modeled on the scripting service.
package store

import (
	"context"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Log is one stored log line. Time is the producer's unix-millisecond timestamp.
type Log struct {
	ID      int64  `gorm:"primaryKey"`
	Time    int64  `gorm:"index"`
	Level   string `gorm:"type:text"`
	Message string `gorm:"type:text"`
	Source  string `gorm:"type:text"`
}

// Store wraps the GORM connection.
type Store struct {
	db *gorm.DB
}

// New opens the connection and migrates the schema.
func New(dsn string) (*Store, error) {
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})

	if err != nil {
		return nil, err
	}

	if err := db.AutoMigrate(&Log{}); err != nil {
		return nil, err
	}

	return &Store{db: db}, nil
}

// Close closes the connection pool.
func (s *Store) Close() {
	if sqlDB, err := s.db.DB(); err == nil {
		_ = sqlDB.Close()
	}
}

// Append inserts a batch of log lines.
func (s *Store) Append(ctx context.Context, rows []Log) error {
	if len(rows) == 0 {
		return nil
	}

	return s.db.WithContext(ctx).Create(&rows).Error
}

// Recent returns the last `limit` log lines in chronological order.
func (s *Store) Recent(ctx context.Context, limit int) ([]Log, error) {
	if limit <= 0 {
		limit = 500
	}

	var rows []Log
	err := s.db.WithContext(ctx).Order("id desc").Limit(limit).Find(&rows).Error

	if err != nil {
		return nil, err
	}

	// reverse to chronological (oldest first)
	for i, j := 0, len(rows)-1; i < j; i, j = i+1, j-1 {
		rows[i], rows[j] = rows[j], rows[i]
	}

	return rows, nil
}

// Clear removes all stored logs.
func (s *Store) Clear(ctx context.Context) error {
	return s.db.WithContext(ctx).Where("1 = 1").Delete(&Log{}).Error
}
