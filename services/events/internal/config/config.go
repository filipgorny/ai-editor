// Package config wczytuje config serwisu events z sekcji "events".
package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Addr      string `yaml:"addr"`
	RedisAddr string `yaml:"redis_addr"`
}

func Default() Config {
	var c Config

	c.Addr = "127.0.0.1:50091"
	c.RedisAddr = "127.0.0.1:6379"

	return c
}

func Load(path string) (Config, error) {
	wrapper := struct {
		Events Config `yaml:"events"`
	}{Events: Default()}

	data, err := os.ReadFile(path)

	if err == nil {
		if err := yaml.Unmarshal(data, &wrapper); err != nil {
			return wrapper.Events, err
		}
	} else if !os.IsNotExist(err) {
		return wrapper.Events, err
	}

	c := wrapper.Events

	if v := os.Getenv("EVENTS_ADDR"); v != "" {
		c.Addr = v
	}

	if v := os.Getenv("REDIS_ADDR"); v != "" {
		c.RedisAddr = v
	}

	return c, nil
}
