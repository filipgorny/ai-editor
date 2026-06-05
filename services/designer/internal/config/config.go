// Package config wczytuje konfigurację designera z sekcji "designer" pliku
// config/ai-architect.yaml (env nadpisuje). Designer to jedyny serwis z DB.
package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Addr        string `yaml:"addr"`
	ScannerAddr string `yaml:"scanner_addr"`

	Database struct {
		URL string `yaml:"url"`
	} `yaml:"database"`
}

func Default() Config {
	var c Config

	c.Addr = "127.0.0.1:50081"
	c.ScannerAddr = "127.0.0.1:50051"
	c.Database.URL = "postgres://architect:architect@localhost:5432/architect?sslmode=disable"

	return c
}

func Load(path string) (Config, error) {
	wrapper := struct {
		Designer Config `yaml:"designer"`
	}{Designer: Default()}

	data, err := os.ReadFile(path)

	if err == nil {
		if err := yaml.Unmarshal(data, &wrapper); err != nil {
			return wrapper.Designer, err
		}
	} else if !os.IsNotExist(err) {
		return wrapper.Designer, err
	}

	c := wrapper.Designer

	if v := os.Getenv("DESIGNER_ADDR"); v != "" {
		c.Addr = v
	}

	if v := os.Getenv("SCANNER_ADDR"); v != "" {
		c.ScannerAddr = v
	}

	if v := os.Getenv("DATABASE_URL"); v != "" {
		c.Database.URL = v
	}

	return c, nil
}
