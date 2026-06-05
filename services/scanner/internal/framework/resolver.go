// Package framework rozpoznaje, jaki framework został użyty w aplikacji i czy
// mamy dla niego zarejestrowany (i włączony w configu) plugin.
package framework

import "github.com/filipgorny/ai-architect/plugins"

// Resolution to wynik rozpoznania frameworka dla katalogu aplikacji.
type Resolution struct {
	Framework string
	Plugin    plugins.Plugin
	HasPlugin bool
}

// Resolver przegląda włączone pluginy i dopasowuje je do katalogu aplikacji.
type Resolver struct {
	enabled []plugins.Plugin
}

// NewResolver buduje resolver z listy włączonych nazw pluginów (z configu).
// Nazwy, dla których nie ma zarejestrowanego pluginu, są pomijane.
func NewResolver(enabled []string) *Resolver {
	var selected []plugins.Plugin

	for _, name := range enabled {
		if p, ok := plugins.Get(name); ok {
			selected = append(selected, p)
		}
	}

	return &Resolver{enabled: selected}
}

// Resolve sprawdza, jaki framework jest użyty w appDir i czy mamy dla niego plugin.
// Gdy nic nie pasuje, zwraca pustą Resolution (HasPlugin == false).
func (r *Resolver) Resolve(appDir string) Resolution {
	for _, p := range r.enabled {
		if p.Detect(appDir) {
			return Resolution{Framework: p.Framework(), Plugin: p, HasPlugin: true}
		}
	}

	return Resolution{}
}

// All zwraca wszystkie włączone pluginy (głęboki skan uruchamia każdy z nich).
func (r *Resolver) All() []plugins.Plugin {
	return r.enabled
}

// Fallback zwraca pierwszy włączony plugin (gdy detekcja zawiodła, a i tak
// chcemy spróbować ekstrakcji — np. głęboki skan serwisu bez czystych markerów).
func (r *Resolver) Fallback() plugins.Plugin {
	if len(r.enabled) == 0 {
		return nil
	}

	return r.enabled[0]
}

// Enabled zwraca nazwy aktywnych (zarejestrowanych) pluginów.
func (r *Resolver) Enabled() []string {
	names := make([]string, 0, len(r.enabled))

	for _, p := range r.enabled {
		names = append(names, p.Framework())
	}

	return names
}
