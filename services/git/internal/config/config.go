// Package config wczytuje konfigurację serwisu git z sekcji "git".
package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Addr string `yaml:"addr"`
	// Dir to katalog roboczy, gdzie serwis trzyma wgrane kopie .git. Puste = temp OS.
	Dir string `yaml:"dir"`
}

func Default() Config {
	var c Config

	c.Addr = "127.0.0.1:50131"
	c.Dir = ""

	return c
}

func Load(path string) (Config, error) {
	wrapper := struct {
		Git Config `yaml:"git"`
	}{Git: Default()}

	data, err := os.ReadFile(path)

	if err == nil {
		if err := yaml.Unmarshal(data, &wrapper); err != nil {
			return wrapper.Git, err
		}
	} else if !os.IsNotExist(err) {
		return wrapper.Git, err
	}

	c := wrapper.Git

	if v := os.Getenv("GIT_ADDR"); v != "" {
		c.Addr = v
	}

	if v := os.Getenv("GIT_DIR_CACHE"); v != "" {
		c.Dir = v
	}

	return c, nil
}
