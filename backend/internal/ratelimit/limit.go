package ratelimit

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

type Redis struct {
	rdb *redis.Client
}

func New(rdb *redis.Client) *Redis {
	return &Redis{rdb: rdb}
}

// Allow returns true if under limit (max per window).
func (l *Redis) Allow(ctx context.Context, key string, max int64, window time.Duration) (bool, error) {
	if l == nil || l.rdb == nil {
		return true, nil
	}
	k := "rl:" + key
	pipe := l.rdb.TxPipeline()
	incr := pipe.Incr(ctx, k)
	pipe.Expire(ctx, k, window)
	if _, err := pipe.Exec(ctx); err != nil {
		return false, err
	}
	n, err := incr.Result()
	if err != nil {
		return false, err
	}
	return n <= max, nil
}

func ClientIPKey(prefix, ip string) string {
	return fmt.Sprintf("%s:%s", prefix, ip)
}
