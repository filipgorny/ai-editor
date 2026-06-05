// Command events to serwis zdarzeń (Redis) powiązanych z plikami/nodami.
package main

import (
	"flag"
	"log"
	"net"

	"google.golang.org/grpc"

	eventsv1 "github.com/filipgorny/ai-architect/proto/events/v1"
	"github.com/filipgorny/ai-architect/services/events/internal/config"
	"github.com/filipgorny/ai-architect/services/events/internal/server"
	"github.com/filipgorny/ai-architect/services/events/internal/store"
)

func main() {
	configPath := flag.String("config", "config/ai-architect.yaml", "ścieżka do configu")
	flag.Parse()

	cfg, err := config.Load(*configPath)

	if err != nil {
		log.Fatalf("config: %v", err)
	}

	st := store.New(cfg.RedisAddr)

	lis, err := net.Listen("tcp", cfg.Addr)

	if err != nil {
		log.Fatalf("listen %s: %v", cfg.Addr, err)
	}

	gs := grpc.NewServer()
	eventsv1.RegisterEventsServer(gs, server.New(st))

	log.Printf("events: nasłuch gRPC na %s | redis=%s", cfg.Addr, cfg.RedisAddr)

	if err := gs.Serve(lis); err != nil {
		log.Fatalf("serve: %v", err)
	}
}
