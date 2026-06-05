package store

import (
	"context"
	"time"

	"github.com/filipgorny/ai-architect/plugins"
)

// Link to krawędź grafu (do innego bytu po nazwie) z etykietą relacji.
type Link struct {
	Target string `json:"target"`
	Label  string `json:"label"`
}

// Element to byt-matka: jeden model dla modułów/kontrolerów/serwisów/komponentów/
// klas/funkcji. Pozwala designerowi ładować wszystko jednym zapytaniem.
type Element struct {
	ID        int64    `gorm:"primaryKey"`
	AppID     int64    `gorm:"index"`
	Framework string
	Kind      string
	Name      string
	File      string
	Route     string
	Functions []string `gorm:"serializer:json"`
	Links     []Link   `gorm:"serializer:json"`
	CreatedAt time.Time
}

func (s *Store) InsertElement(ctx context.Context, appID int64, e plugins.Element) error {
	links := make([]Link, 0, len(e.Links))

	for _, l := range e.Links {
		links = append(links, Link{Target: l.Target, Label: l.Label})
	}

	return s.db.WithContext(ctx).Create(&Element{
		AppID:     appID,
		Framework: e.Framework,
		Kind:      e.Kind,
		Name:      e.Name,
		File:      e.File,
		Route:     e.Route,
		Functions: e.Functions,
		Links:     links,
	}).Error
}

// ElementsByApp zwraca WSZYSTKIE byty aplikacji jednym zapytaniem.
func (s *Store) ElementsByApp(ctx context.Context, appID int64) ([]Element, error) {
	var out []Element

	err := s.db.WithContext(ctx).Where("app_id = ?", appID).Order("id").Find(&out).Error

	return out, err
}
