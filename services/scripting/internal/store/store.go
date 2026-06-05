// Package store is the scripting service's database access (Postgres, GORM). It holds user
// scripts (name + content). Modeled on the designer service.
package store

import (
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Store wraps the GORM connection.
type Store struct {
	db *gorm.DB
}

// New opens the connection and migrates the schema (AutoMigrate).
func New(dsn string) (*Store, error) {
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})

	if err != nil {
		return nil, err
	}

	if err := db.AutoMigrate(&Script{}); err != nil {
		return nil, err
	}

	return &Store{db: db}, nil
}

// DB exposes the GORM handle.
func (s *Store) DB() *gorm.DB {
	return s.db
}

// Close closes the connection pool.
func (s *Store) Close() {
	if sqlDB, err := s.db.DB(); err == nil {
		_ = sqlDB.Close()
	}
}
