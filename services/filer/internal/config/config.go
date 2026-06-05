// Package config wczytuje konfigurację serwisu filer z sekcji "filer".
package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Addr string `yaml:"addr"`
}

func Default() Config {
	var c Config

	c.Addr = "127.0.0.1:50101"

	return c
}

func Load(path string) (Config, error) {
	wrapper := struct {
		Filer Config `yaml:"filer"`
	}{Filer: Default()}

	data, err := os.ReadFile(path)

	if err == nil {
		if err := yaml.Unmarshal(data, &wrapper); err != nil {
			return wrapper.Filer, err
		}
	} else if !os.IsNotExist(err) {
		return wrapper.Filer, err
	}

	c := wrapper.Filer

	if v := os.Getenv("FILER_ADDR"); v != "" {
		c.Addr = v
	}

	return c, nil
}
