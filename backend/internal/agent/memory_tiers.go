package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	memKeyL1Fmt = "texpad:agent:l1:%s:%s"
	l1TTL       = time.Hour
)

func compressForTier(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	return s[:max] + "\n…(compressed)"
}

func (s *Service) loadMemoryBlock(ctx context.Context, userID, projectID uuid.UUID) string {
	var b strings.Builder
	if s.rdb != nil {
		k := fmt.Sprintf(memKeyL1Fmt, userID.String(), projectID.String())
		if v, err := s.rdb.Get(ctx, k).Result(); err == nil && strings.TrimSpace(v) != "" {
			b.WriteString("### L1 会话缓存\n")
			b.WriteString(compressForTier(v, 2000))
			b.WriteString("\n\n")
		}
	}
	rows, err := s.pool.Query(ctx, `
SELECT content, COALESCE(meta::text,'{}') FROM agent_memories
WHERE user_id=$1 AND (project_id=$2 OR (project_id IS NULL AND (meta->>'tier')='3'))
ORDER BY created_at DESC LIMIT 24`, userID, projectID)
	if err != nil {
		return b.String()
	}
	defer rows.Close()
	l2, l3, l4 := 0, 0, 0
	for rows.Next() {
		var content, meta string
		if rows.Scan(&content, &meta) != nil {
			continue
		}
		tier := 0
		var m map[string]any
		if json.Unmarshal([]byte(meta), &m) == nil {
			switch v := m["tier"].(type) {
			case float64:
				tier = int(v)
			}
		}
		switch tier {
		case 2:
			if l2 >= 4 {
				continue
			}
			l2++
			b.WriteString("### L2 项目记忆\n")
			b.WriteString(compressForTier(content, 1200))
			b.WriteString("\n\n")
		case 3:
			if l3 >= 2 {
				continue
			}
			l3++
			b.WriteString("### L3 用户记忆\n")
			b.WriteString(compressForTier(content, 800))
			b.WriteString("\n\n")
		case 4:
			if l4 >= 2 {
				continue
			}
			l4++
			b.WriteString("### L4 长期摘要\n")
			b.WriteString(compressForTier(content, 600))
			b.WriteString("\n\n")
		}
	}
	return strings.TrimSpace(b.String())
}

func (s *Service) saveL1Session(ctx context.Context, userID, projectID uuid.UUID, summary string) {
	if s.rdb == nil || strings.TrimSpace(summary) == "" {
		return
	}
	k := fmt.Sprintf(memKeyL1Fmt, userID.String(), projectID.String())
	v := compressForTier(summary, 8000)
	_ = s.rdb.Set(ctx, k, v, l1TTL).Err()
}

func (s *Service) saveTierMemory(ctx context.Context, userID uuid.UUID, projectID *uuid.UUID, tier int, kind, content string) error {
	meta := map[string]any{"tier": tier, "kind": kind}
	mb, _ := json.Marshal(meta)
	var proj any
	if projectID != nil {
		proj = *projectID
	}
	_, err := s.pool.Exec(ctx, `INSERT INTO agent_memories (user_id, project_id, content, meta) VALUES ($1,$2,$3,$4)`,
		userID, proj, compressForTier(content, 12000), mb)
	return err
}
