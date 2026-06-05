// Command filer to serwis zarządzający plikami projektu (gateway pośredniczy).
package main

import (
	"flag"
	"log"
	"net"

	"google.golang.org/grpc"

	filerv1 "github.com/filipgorny/ai-architect/proto/filer/v1"
	"github.com/filipgorny/ai-architect/services/filer/internal/config"
	"github.com/filipgorny/ai-architect/services/filer/internal/server"
)

func main() {
	configPath := flag.String("config", "config/ai-architect.yaml", "ścieżka do configu")
	flag.Parse()

	cfg, err := config.Load(*configPath)

	if err != nil {
		log.Fatalf("config: %v", err)
	}

	lis, err := net.Listen("tcp", cfg.Addr)

	if err != nil {
		log.Fatalf("listen %s: %v", cfg.Addr, err)
	}

	gs := grpc.NewServer()
	filerv1.RegisterFilerServer(gs, server.New())

	log.Printf("filer: nasłuch gRPC na %s", cfg.Addr)

	if err := gs.Serve(lis); err != nil {
		log.Fatalf("serve: %v", err)
	}
}
