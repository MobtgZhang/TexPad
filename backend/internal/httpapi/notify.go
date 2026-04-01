package httpapi

import (
	"sync"

	"github.com/google/uuid"
)

type compileNotifier struct {
	mu   sync.Mutex
	subs map[uuid.UUID][]chan uuid.UUID
}

func newCompileNotifier() *compileNotifier {
	return &compileNotifier{subs: make(map[uuid.UUID][]chan uuid.UUID)}
}

func (n *compileNotifier) subscribe(projectID uuid.UUID) chan uuid.UUID {
	ch := make(chan uuid.UUID, 4)
	n.mu.Lock()
	n.subs[projectID] = append(n.subs[projectID], ch)
	n.mu.Unlock()
	return ch
}

func (n *compileNotifier) unsubscribe(projectID uuid.UUID, ch chan uuid.UUID) {
	n.mu.Lock()
	list := n.subs[projectID]
	out := list[:0]
	for _, c := range list {
		if c != ch {
			out = append(out, c)
		}
	}
	if len(out) == 0 {
		delete(n.subs, projectID)
	} else {
		n.subs[projectID] = out
	}
	n.mu.Unlock()
}

func (n *compileNotifier) publish(projectID, jobID uuid.UUID) {
	n.mu.Lock()
	list := append([]chan uuid.UUID(nil), n.subs[projectID]...)
	n.mu.Unlock()
	for _, ch := range list {
		select {
		case ch <- jobID:
		default:
		}
	}
}
