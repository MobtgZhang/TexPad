package httpapi

import (
	"context"

	"github.com/google/uuid"
)

type ctxKey int

const (
	ctxUserID ctxKey = iota + 1
	ctxShareProject
	ctxShareRole
)

func WithUserID(ctx context.Context, id uuid.UUID) context.Context {
	return context.WithValue(ctx, ctxUserID, id)
}

func UserID(ctx context.Context) (uuid.UUID, bool) {
	v := ctx.Value(ctxUserID)
	id, ok := v.(uuid.UUID)
	return id, ok
}

func WithShare(ctx context.Context, projectID uuid.UUID, role string) context.Context {
	ctx = context.WithValue(ctx, ctxShareProject, projectID)
	return context.WithValue(ctx, ctxShareRole, role)
}

func Share(ctx context.Context) (projectID uuid.UUID, role string, ok bool) {
	p, pOK := ctx.Value(ctxShareProject).(uuid.UUID)
	r, rOK := ctx.Value(ctxShareRole).(string)
	return p, r, pOK && rOK
}
