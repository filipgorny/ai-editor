// Command designer to serwis domenowy: persystuje wyniki scannera (jedyny
// serwis z dostępem do bazy) i serwuje grafy dla aplikacji Electron.
package main

import (
	"flag"
	"log"
	"net"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	gatewayv1 "github.com/filipgorny/ai-architect/proto/gateway/v1"
	scannerv1 "github.com/filipgorny/ai-architect/proto/scanner/v1"
	"github.com/filipgorny/ai-architect/services/designer/internal/config"
	"github.com/filipgorny/ai-architect/services/designer/internal/graph"
	"github.com/filipgorny/ai-architect/services/designer/internal/server"
	"github.com/filipgorny/ai-architect/services/designer/internal/store"
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

	conn, err := grpc.NewClient(cfg.ScannerAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))

	if err != nil {
		log.Fatalf("scanner client: %v", err)
	}

	defer conn.Close()

	scanner := scannerv1.NewScannerClient(conn)
	gb := graph.NewBuilder(st.DB())

	lis, err := net.Listen("tcp", cfg.Addr)

	if err != nil {
		log.Fatalf("listen %s: %v", cfg.Addr, err)
	}

	gs := grpc.NewServer()
	gatewayv1.RegisterGatewayServer(gs, server.New(scanner, st, gb))

	log.Printf("designer: nasłuch gRPC na %s | scanner=%s", cfg.Addr, cfg.ScannerAddr)

	if err := gs.Serve(lis); err != nil {
		log.Fatalf("serve: %v", err)
	}
}
