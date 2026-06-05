// Package history przechowuje historię rozmów z LLM (pamięć kontekstu) per sesja.
// Trzymane w pamięci procesu, ograniczone liczbą wiadomości na sesję. Pozwala
// dużym modelom zachować kontekst między kolejnymi wywołaniami Generate.
package history

import (
	"strings"
	"sync"
)

// Message to jedna tura rozmowy.
type Message struct {
	Role    string // "user" | "assistant"
	Content string
}

// Store to wątkowo-bezpieczna mapa sesja → wiadomości (najnowsze na końcu).
type Store struct {
	mu       sync.Mutex
	sessions map[string][]Message
	maxMsgs  int // twardy limit wiadomości na sesję (najstarsze wypadają)
}

func New() *Store {
	return &Store{sessions: make(map[string][]Message), maxMsgs: 40}
}

// Append dopisuje wiadomość do sesji, przycinając do maxMsgs.
func (s *Store) Append(session, role, content string) {
	if session == "" || strings.TrimSpace(content) == "" {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	msgs := append(s.sessions[session], Message{Role: role, Content: content})

	if len(msgs) > s.maxMsgs {
		msgs = msgs[len(msgs)-s.maxMsgs:]
	}

	s.sessions[session] = msgs
}

// Render składa najnowsze tury mieszczące się w budżecie znaków (chronologicznie).
// Pusty string gdy brak historii.
func (s *Store) Render(session string, budget int) string {
	s.mu.Lock()
	defer s.mu.Unlock()

	msgs := s.sessions[session]

	if len(msgs) == 0 {
		return ""
	}

	// Bierz od końca, dopóki mieści się w budżecie (zawsze co najmniej jedna tura).
	var picked []Message
	total := 0

	for i := len(msgs) - 1; i >= 0; i-- {
		c := msgs[i].Content

		if total+len(c) > budget && len(picked) > 0 {
			break
		}

		picked = append(picked, msgs[i])
		total += len(c)
	}

	var b strings.Builder

	for i := len(picked) - 1; i >= 0; i-- {
		who := "Użytkownik"

		if picked[i].Role == "assistant" {
			who = "Asystent"
		}

		b.WriteString(who + ": " + picked[i].Content + "\n")
	}

	return b.String()
}

// Clear usuwa historię sesji (np. „nowa rozmowa").
func (s *Store) Clear(session string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	delete(s.sessions, session)
}
