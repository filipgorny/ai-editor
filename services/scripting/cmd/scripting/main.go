// Command scripting is the domain service that stores user scripts (Lua) in Postgres.
// The gateway only forwards — all the logic and the database live here.
package main

import (
	"flag"
	"log"
	"net"

	"google.golang.org/grpc"

	scriptingv1 "github.com/filipgorny/ai-architect/proto/scripting/v1"
	"github.com/filipgorny/ai-architect/services/scripting/internal/config"
	"github.com/filipgorny/ai-architect/services/scripting/internal/server"
	"github.com/filipgorny/ai-architect/services/scripting/internal/store"
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
	scriptingv1.RegisterScriptingServer(gs, server.New(st))

	log.Printf("scripting: nasłuch gRPC na %s", cfg.Addr)

	if err := gs.Serve(lis); err != nil {
		log.Fatalf("serve: %v", err)
	}
}
