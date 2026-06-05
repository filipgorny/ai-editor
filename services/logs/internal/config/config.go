// Package config loads the logs service configuration from the "logs" section of
// config/ai-architect.yaml (env overrides). Logs keeps app log lines in its own database.
package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Addr string `yaml:"addr"`

	Database struct {
		URL string `yaml:"url"`
	} `yaml:"database"`
}

func Default() Config {
	var c Config

	c.Addr = "127.0.0.1:50121"
	c.Database.URL = "postgres://architect:architect@localhost:5432/architect?sslmode=disable"

	return c
}

func Load(path string) (Config, error) {
	wrapper := struct {
		Logs Config `yaml:"logs"`
	}{Logs: Default()}

	data, err := os.ReadFile(path)

	if err == nil {
		if err := yaml.Unmarshal(data, &wrapper); err != nil {
			return wrapper.Logs, err
		}
	} else if !os.IsNotExist(err) {
		return wrapper.Logs, err
	}

	c := wrapper.Logs

	// LOGS_DATABASE_URL takes priority so the logs service can use a separate database from the
	// rest; otherwise it falls back to the shared DATABASE_URL.
	if v := os.Getenv("LOGS_ADDR"); v != "" {
		c.Addr = v
	}

	if v := os.Getenv("LOGS_DATABASE_URL"); v != "" {
		c.Database.URL = v
	} else if v := os.Getenv("DATABASE_URL"); v != "" {
		c.Database.URL = v
	}

	return c, nil
}
