// Command ai to agent AI ze skillami (czytanie plików, eventy) i planowaniem.
package main

import (
	"flag"
	"log"
	"net"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	"github.com/filipgorny/ai-architect/llm"
	aiv1 "github.com/filipgorny/ai-architect/proto/ai/v1"
	eventsv1 "github.com/filipgorny/ai-architect/proto/events/v1"
	"github.com/filipgorny/ai-architect/services/ai/internal/agent"
	"github.com/filipgorny/ai-architect/services/ai/internal/config"
	"github.com/filipgorny/ai-architect/services/ai/internal/server"
	"github.com/filipgorny/ai-architect/services/ai/internal/tokenstore"
)

func main() {
	configPath := flag.String("config", "config/ai-architect.yaml", "ścieżka do configu")
	flag.Parse()

	cfg, err := config.Load(*configPath)

	if err != nil {
		log.Fatalf("config: %v", err)
	}

	provider, err := llm.New(cfg.LLM)

	if err != nil {
		log.Fatalf("llm: %v", err)
	}

	conn, err := grpc.NewClient(cfg.EventsAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))

	if err != nil {
		log.Fatalf("events client: %v", err)
	}

	defer conn.Close()

	events := eventsv1.NewEventsClient(conn)
	ag := agent.New(provider, cfg.LLM, events)

	// Token OAuth Claude: gdy skonfigurowano REDIS_ADDR — trzymamy go w Redisie (przeżywa
	// restart, współdzielony), inaczej w pliku/wolumenie. Magazyn wstrzykujemy PRZED odczytem.
	if cfg.RedisAddr != "" {
		llm.SetClaudeTokenStore(tokenstore.NewRedis(cfg.RedisAddr))
	}

	llm.LoadClaudeToken()

	lis, err := net.Listen("tcp", cfg.Addr)

	if err != nil {
		log.Fatalf("listen %s: %v", cfg.Addr, err)
	}

	gs := grpc.NewServer()
	aiv1.RegisterAiServer(gs, server.New(ag))

	log.Printf("ai: nasłuch gRPC na %s | llm=%s | events=%s", cfg.Addr, provider.Name(), cfg.EventsAddr)

	if err := gs.Serve(lis); err != nil {
		log.Fatalf("serve: %v", err)
	}
}
