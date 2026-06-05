// Package config wczytuje konfigurację gatewaya z sekcji "gateway" pliku
// config/ai-architect.yaml (env nadpisuje). Gateway nie ma DB — proxuje do designera.
package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Addr         string `yaml:"addr"`
	DesignerAddr string `yaml:"designer_addr"`
	AIAddr       string `yaml:"ai_addr"`
	EventsAddr   string `yaml:"events_addr"`
}

func Default() Config {
	var c Config

	c.Addr = "127.0.0.1:50061"
	c.DesignerAddr = "127.0.0.1:50081"
	c.AIAddr = "127.0.0.1:50071"
	c.EventsAddr = "127.0.0.1:50091"

	return c
}

func Load(path string) (Config, error) {
	wrapper := struct {
		Gateway Config `yaml:"gateway"`
	}{Gateway: Default()}

	data, err := os.ReadFile(path)

	if err == nil {
		if err := yaml.Unmarshal(data, &wrapper); err != nil {
			return wrapper.Gateway, err
		}
	} else if !os.IsNotExist(err) {
		return wrapper.Gateway, err
	}

	c := wrapper.Gateway

	if v := os.Getenv("GATEWAY_ADDR"); v != "" {
		c.Addr = v
	}

	if v := os.Getenv("DESIGNER_ADDR"); v != "" {
		c.DesignerAddr = v
	}

	if v := os.Getenv("AI_ADDR"); v != "" {
		c.AIAddr = v
	}

	if v := os.Getenv("EVENTS_ADDR"); v != "" {
		c.EventsAddr = v
	}

	return c, nil
}
