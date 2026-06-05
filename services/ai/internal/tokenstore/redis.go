// Package tokenstore persystuje token OAuth Claude w Redisie, by przeżył restart serwisu ai
// (i był współdzielony, gdyby kiedyś było więcej instancji). Implementuje llm.ClaudeTokenStore.
package tokenstore

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

// claudeTokenKey to klucz, pod którym trzymamy token w Redisie.
const claudeTokenKey = "ai:claude:token"

// opTimeout — krótki budżet na operację Redis (start/zapis nie mogą wisieć).
const opTimeout = 3 * time.Second

// Redis to magazyn tokena oparty o Redis.
type Redis struct {
	rdb *redis.Client
}

// NewRedis tworzy magazyn pod danym adresem Redis (np. "redis:6379").
func NewRedis(addr string) *Redis {
	return &Redis{rdb: redis.NewClient(&redis.Options{Addr: addr})}
}

// Load zwraca zapisany token ("" gdy brak).
func (r *Redis) Load() (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)

	defer cancel()

	tok, err := r.rdb.Get(ctx, claudeTokenKey).Result()

	if err == redis.Nil {
		return "", nil
	}

	return tok, err
}

// Save zapisuje token (pusty kasuje wpis).
func (r *Redis) Save(token string) error {
	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)

	defer cancel()

	if token == "" {
		return r.rdb.Del(ctx, claudeTokenKey).Err()
	}

	return r.rdb.Set(ctx, claudeTokenKey, token, 0).Err()
}
