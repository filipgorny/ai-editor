// Command scanner to BEZSTANOWY serwer gRPC analizy kodu (bez bazy). LLM idzie
// przez serwis ai.
package main

import (
	"flag"
	"log"
	"net"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	_ "github.com/filipgorny/ai-architect/plugins/golang"   // rejestracja pluginu
	_ "github.com/filipgorny/ai-architect/plugins/nestjs"   // rejestracja pluginu
	_ "github.com/filipgorny/ai-architect/plugins/protobuf" // rejestracja pluginu
	_ "github.com/filipgorny/ai-architect/plugins/react"      // rejestracja pluginu
	_ "github.com/filipgorny/ai-architect/plugins/typescript" // rejestracja pluginu
	_ "github.com/filipgorny/ai-architect/plugins/vite"       // rejestracja pluginu
	aiv1 "github.com/filipgorny/ai-architect/proto/ai/v1"
	scannerv1 "github.com/filipgorny/ai-architect/proto/scanner/v1"
	"github.com/filipgorny/ai-architect/services/scanner/internal/config"
	"github.com/filipgorny/ai-architect/services/scanner/internal/framework"
	"github.com/filipgorny/ai-architect/services/scanner/internal/scan"
	"github.com/filipgorny/ai-architect/services/scanner/internal/server"
)

func main() {
	configPath := flag.String("config", "config/ai-architect.yaml", "ścieżka do configu")
	flag.Parse()

	cfg, err := config.Load(*configPath)

	if err != nil {
		log.Fatalf("config: %v", err)
	}

	conn, err := grpc.NewClient(cfg.AIAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))

	if err != nil {
		log.Fatalf("ai client: %v", err)
	}

	defer conn.Close()

	resolver := framework.NewResolver(cfg.Plugins)
	scanner := scan.New(resolver, aiv1.NewAiClient(conn), cfg.Scan.Concurrency, cfg.Scan.MaxFiles, cfg.Scan.DescribeFiles)

	lis, err := net.Listen("tcp", cfg.Server.Addr)

	if err != nil {
		log.Fatalf("listen %s: %v", cfg.Server.Addr, err)
	}

	gs := grpc.NewServer()
	scannerv1.RegisterScannerServer(gs, server.New(scanner))

	log.Printf("scanner: nasłuch gRPC na %s | ai=%s | pluginy=%v", cfg.Server.Addr, cfg.AIAddr, resolver.Enabled())

	if err := gs.Serve(lis); err != nil {
		log.Fatalf("serve: %v", err)
	}
}
