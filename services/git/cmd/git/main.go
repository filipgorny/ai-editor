// Command git to serwis autorstwa i diff-review (gateway pośredniczy). Projekt
// wgrywa swoją kopię .git przez UploadRepo, a serwis odpowiada o autorstwo i diff.
package main

import (
	"flag"
	"log"
	"net"

	"google.golang.org/grpc"

	gitv1 "github.com/filipgorny/ai-architect/proto/git/v1"
	"github.com/filipgorny/ai-architect/services/git/internal/config"
	"github.com/filipgorny/ai-architect/services/git/internal/server"
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

	// Upload .git potrafi być duży (packfiles) — podnosimy limit wiadomości gRPC.
	gs := grpc.NewServer(grpc.MaxRecvMsgSize(64 * 1024 * 1024))
	gitv1.RegisterGitServer(gs, server.New(cfg.Dir))

	log.Printf("git: nasłuch gRPC na %s", cfg.Addr)

	if err := gs.Serve(lis); err != nil {
		log.Fatalf("serve: %v", err)
	}
}
