// Package config wczytuje config serwisu ai z sekcji "ai".
package config

import (
	"os"

	"gopkg.in/yaml.v3"

	"github.com/filipgorny/ai-architect/llm"
)

type Config struct {
	Addr       string     `yaml:"addr"`
	EventsAddr string     `yaml:"events_addr"`
	RedisAddr  string     `yaml:"redis_addr"` // gdy ustawiony, token Claude trzymamy w Redisie (inaczej plik)
	LLM        llm.Config `yaml:"llm"`
}

func Default() Config {
	var c Config

	c.Addr = "127.0.0.1:50071"
	c.EventsAddr = "127.0.0.1:50091"
	c.LLM = llm.Config{Provider: "ollama", Model: "qwen2.5-coder:14b", Host: "http://localhost:11434"}

	return c
}

func Load(path string) (Config, error) {
	wrapper := struct {
		AI Config `yaml:"ai"`
	}{AI: Default()}

	data, err := os.ReadFile(path)

	if err == nil {
		if err := yaml.Unmarshal(data, &wrapper); err != nil {
			return wrapper.AI, err
		}
	} else if !os.IsNotExist(err) {
		return wrapper.AI, err
	}

	c := wrapper.AI

	if v := os.Getenv("AI_ADDR"); v != "" {
		c.Addr = v
	}

	if v := os.Getenv("EVENTS_ADDR"); v != "" {
		c.EventsAddr = v
	}

	if v := os.Getenv("REDIS_ADDR"); v != "" {
		c.RedisAddr = v
	}

	if v := os.Getenv("OLLAMA_HOST"); v != "" {
		c.LLM.Host = v
	}

	if v := os.Getenv("OLLAMA_MODEL"); v != "" {
		c.LLM.Model = v
	}

	if v := os.Getenv("OPENAI_API_KEY"); v != "" {
		c.LLM.APIKey = v
		c.LLM.Provider = "openai"
	}

	return c, nil
}
