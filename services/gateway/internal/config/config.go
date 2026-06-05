// Package config wczytuje konfigurację gatewaya z sekcji "gateway" pliku
// config/ai-architect.yaml (env nadpisuje). Gateway nie ma DB — proxuje do designera.
package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Addr          string `yaml:"addr"`
	DesignerAddr  string `yaml:"designer_addr"`
	AIAddr        string `yaml:"ai_addr"`
	EventsAddr    string `yaml:"events_addr"`
	FilerAddr     string `yaml:"filer_addr"`
	ScriptingAddr string `yaml:"scripting_addr"`
	LogsAddr      string `yaml:"logs_addr"`
	ScannerAddr   string `yaml:"scanner_addr"`
	GitAddr       string `yaml:"git_addr"`
}

func Default() Config {
	var c Config

	c.Addr = "127.0.0.1:50061"
	c.DesignerAddr = "127.0.0.1:50081"
	c.AIAddr = "127.0.0.1:50071"
	c.EventsAddr = "127.0.0.1:50091"
	c.FilerAddr = "127.0.0.1:50101"
	c.ScriptingAddr = "127.0.0.1:50111"
	c.LogsAddr = "127.0.0.1:50121"
	c.ScannerAddr = "127.0.0.1:50051"
	c.GitAddr = "127.0.0.1:50131"

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

	if v := os.Getenv("FILER_ADDR"); v != "" {
		c.FilerAddr = v
	}

	if v := os.Getenv("SCRIPTING_ADDR"); v != "" {
		c.ScriptingAddr = v
	}

	if v := os.Getenv("LOGS_ADDR"); v != "" {
		c.LogsAddr = v
	}

	if v := os.Getenv("SCANNER_ADDR"); v != "" {
		c.ScannerAddr = v
	}

	if v := os.Getenv("GIT_ADDR"); v != "" {
		c.GitAddr = v
	}

	return c, nil
}
