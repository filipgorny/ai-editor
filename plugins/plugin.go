// Package plugins definiuje interfejs pluginu frameworka, byt-matkę Element
// oraz globalny rejestr. Pluginy rejestrują się przez init() (patrz
// plugins/nestjs, plugins/react), a serwis scanner uruchamia wszystkie włączone.
package plugins

import (
	"context"
	"sort"
)

// Link to skierowana krawędź do innego bytu (po nazwie) z etykietą relacji.
type Link struct {
	Target string
	Label  string // import|controller|provider|injects|renders|method
}

// Element to byt-matka grafu. Wszystkie klocki (moduł, kontroler, serwis,
// komponent, klasa, funkcja) to Element różniący się polem Kind. Dzięki temu
// designer ładuje wszystko jednym zapytaniem.
type Element struct {
	Framework string   // plugin, który wyprodukował byt (nestjs|react) — ustawia scanner
	Kind      string   // module|controller|service|component|class|function
	Name      string
	File      string
	Route     string   // tylko kontrolery
	Functions []string // metody klasy / akcje kontrolera (wspólny typ funkcji)
	Links     []Link   // krawędzie do innych bytów
}

// Entities to komplet bytów zwracany przez plugin dla jednej aplikacji.
type Entities struct {
	Elements []Element
}

// Plugin rozpoznaje konkretny framework i ekstrahuje z niego byty.
type Plugin interface {
	// Framework zwraca nazwę frameworka, np. "nestjs".
	Framework() string
	// Detect sprawdza, czy aplikacja w appDir używa tego frameworka.
	Detect(appDir string) bool
	// Extract wyciąga byty (Elements) z aplikacji w appDir.
	Extract(ctx context.Context, appDir string) (*Entities, error)
}

var registry = map[string]Plugin{}

// Register dodaje plugin do globalnego rejestru (wołane z init() pluginu).
func Register(p Plugin) {
	registry[p.Framework()] = p
}

// Get zwraca plugin po nazwie frameworka.
func Get(framework string) (Plugin, bool) {
	p, ok := registry[framework]

	return p, ok
}

// Available zwraca posortowane nazwy wszystkich zarejestrowanych pluginów.
func Available() []string {
	names := make([]string, 0, len(registry))

	for name := range registry {
		names = append(names, name)
	}

	sort.Strings(names)

	return names
}
