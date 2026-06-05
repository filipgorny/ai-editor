// Package config wczytuje konfigurację scannera z sekcji "scanners" pliku
// config/ai-architect.yaml (env nadpisuje). Scanner jest bezstanowy (bez DB);
// LLM (opis plików) idzie przez serwis ai.
package config

import (
	"os"
	"strconv"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server struct {
		Addr string `yaml:"addr"`
	} `yaml:"server"`

	AIAddr string `yaml:"ai_addr"`

	// Plugins to lista włączonych pluginów frameworków (po nazwie).
	Plugins []string `yaml:"plugins"`

	Scan struct {
		Concurrency   int  `yaml:"concurrency"` // 0 = liczba rdzeni CPU
		MaxFiles      int  `yaml:"max_files"`   // 0 = bez limitu
		DescribeFiles bool `yaml:"describe_files"`
	} `yaml:"scan"`
}

func Default() Config {
	var c Config

	c.Server.Addr = "127.0.0.1:50051"
	c.AIAddr = "127.0.0.1:50071"
	c.Plugins = []string{"nestjs", "react"}
	c.Scan.DescribeFiles = false // drill = same encje (szybko); opis plików opcjonalny

	return c
}

func Load(path string) (Config, error) {
	wrapper := struct {
		Scanners Config `yaml:"scanners"`
	}{Scanners: Default()}

	data, err := os.ReadFile(path)

	if err == nil {
		if err := yaml.Unmarshal(data, &wrapper); err != nil {
			return wrapper.Scanners, err
		}
	} else if !os.IsNotExist(err) {
		return wrapper.Scanners, err
	}

	c := wrapper.Scanners

	applyEnv(&c)

	return c, nil
}

func applyEnv(c *Config) {
	if v := os.Getenv("SCANNER_ADDR"); v != "" {
		c.Server.Addr = v
	}

	if v := os.Getenv("AI_ADDR"); v != "" {
		c.AIAddr = v
	}

	if v := os.Getenv("SCANNER_CONCURRENCY"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.Scan.Concurrency = n
		}
	}

	if v := os.Getenv("SCANNER_MAX_FILES"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.Scan.MaxFiles = n
		}
	}

	if v := os.Getenv("SCANNER_DESCRIBE_FILES"); v != "" {
		c.Scan.DescribeFiles = v == "true" || v == "1"
	}
}
