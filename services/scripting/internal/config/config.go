// Package config loads the scripting service configuration from the "scripting" section
// of config/ai-architect.yaml (env overrides). Scripting keeps user scripts in Postgres.
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

	c.Addr = "127.0.0.1:50111"
	c.Database.URL = "postgres://architect:architect@localhost:5432/architect?sslmode=disable"

	return c
}

func Load(path string) (Config, error) {
	wrapper := struct {
		Scripting Config `yaml:"scripting"`
	}{Scripting: Default()}

	data, err := os.ReadFile(path)

	if err == nil {
		if err := yaml.Unmarshal(data, &wrapper); err != nil {
			return wrapper.Scripting, err
		}
	} else if !os.IsNotExist(err) {
		return wrapper.Scripting, err
	}

	c := wrapper.Scripting

	if v := os.Getenv("SCRIPTING_ADDR"); v != "" {
		c.Addr = v
	}

	if v := os.Getenv("DATABASE_URL"); v != "" {
		c.Database.URL = v
	}

	return c, nil
}
