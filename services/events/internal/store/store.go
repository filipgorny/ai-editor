// Package store przechowuje eventy w Redis, indeksowane po pliku/nodzie/app.
package store

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

type Store struct {
	rdb *redis.Client
}

func New(addr string) *Store {
	return &Store{rdb: redis.NewClient(&redis.Options{Addr: addr})}
}

// Event to zdarzenie powiązane z plikiem lub nodem grafu.
type Event struct {
	ID        string `json:"id"`
	Type      string `json:"type"`
	Title     string `json:"title"`
	Body      string `json:"body"`
	AppID     int64  `json:"app_id"`
	File      string `json:"file"`
	NodeID    string `json:"node_id"`
	CreatedAt int64  `json:"created_at"`
}

// Publish nadaje id + czas i zapisuje event do indeksów (all/file/node/app).
func (s *Store) Publish(ctx context.Context, e Event) (Event, error) {
	id, err := s.rdb.Incr(ctx, "events:seq").Result()

	if err != nil {
		return e, err
	}

	e.ID = strconv.FormatInt(id, 10)

	if e.CreatedAt == 0 {
		e.CreatedAt = time.Now().Unix()
	}

	data, err := json.Marshal(e)

	if err != nil {
		return e, err
	}

	pipe := s.rdb.Pipeline()
	pipe.LPush(ctx, "events:all", data)

	if e.File != "" {
		pipe.LPush(ctx, "events:file:"+e.File, data)
	}

	if e.NodeID != "" {
		pipe.LPush(ctx, "events:node:"+e.NodeID, data)
	}

	if e.AppID != 0 {
		pipe.LPush(ctx, fmt.Sprintf("events:app:%d", e.AppID), data)
	}

	_, err = pipe.Exec(ctx)

	return e, err
}

// List zwraca eventy wg najbardziej szczegółowego filtra (node > file > app > all).
func (s *Store) List(ctx context.Context, file, node string, appID int64, limit int) ([]Event, error) {
	key := "events:all"

	switch {
	case node != "":
		key = "events:node:" + node

	case file != "":
		key = "events:file:" + file

	case appID != 0:
		key = fmt.Sprintf("events:app:%d", appID)
	}

	if limit <= 0 {
		limit = 50
	}

	vals, err := s.rdb.LRange(ctx, key, 0, int64(limit-1)).Result()

	if err != nil {
		return nil, err
	}

	out := make([]Event, 0, len(vals))

	for _, v := range vals {
		var e Event

		if json.Unmarshal([]byte(v), &e) == nil {
			out = append(out, e)
		}
	}

	return out, nil
}
