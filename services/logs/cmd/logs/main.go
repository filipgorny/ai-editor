// Command logs is the domain service that stores the app's log lines in its own database.
// The gateway only forwards — all the logic and the database live here.
package main

import (
	"flag"
	"log"
	"net"

	"google.golang.org/grpc"

	logsv1 "github.com/filipgorny/ai-architect/proto/logs/v1"
	"github.com/filipgorny/ai-architect/services/logs/internal/config"
	"github.com/filipgorny/ai-architect/services/logs/internal/server"
	"github.com/filipgorny/ai-architect/services/logs/internal/store"
)

func main() {
	configPath := flag.String("config", "config/ai-architect.yaml", "ścieżka do configu")
	flag.Parse()

	cfg, err := config.Load(*configPath)

	if err != nil {
		log.Fatalf("config: %v", err)
	}

	st, err := store.New(cfg.Database.URL)

	if err != nil {
		log.Fatalf("baza: %v", err)
	}

	defer st.Close()

	lis, err := net.Listen("tcp", cfg.Addr)

	if err != nil {
		log.Fatalf("listen %s: %v", cfg.Addr, err)
	}

	gs := grpc.NewServer()
	logsv1.RegisterLogsServer(gs, server.New(st))

	log.Printf("logs: nasłuch gRPC na %s", cfg.Addr)

	if err := gs.Serve(lis); err != nil {
		log.Fatalf("serve: %v", err)
	}
}
