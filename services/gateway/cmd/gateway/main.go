// Command gateway to cienki api-gateway dla aplikacji Electron — JEDYNY punkt
// wejścia: proxuje do designera (graf), ai (LLM) i events (Redis).
package main

import (
	"flag"
	"log"
	"net"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	aiv1 "github.com/filipgorny/ai-architect/proto/ai/v1"
	eventsv1 "github.com/filipgorny/ai-architect/proto/events/v1"
	gatewayv1 "github.com/filipgorny/ai-architect/proto/gateway/v1"
	"github.com/filipgorny/ai-architect/services/gateway/internal/config"
	"github.com/filipgorny/ai-architect/services/gateway/internal/server"
)

func dial(addr string) (*grpc.ClientConn, error) {
	return grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
}

func main() {
	configPath := flag.String("config", "config/ai-architect.yaml", "ścieżka do configu")
	flag.Parse()

	cfg, err := config.Load(*configPath)

	if err != nil {
		log.Fatalf("config: %v", err)
	}

	designerConn, err := dial(cfg.DesignerAddr)

	if err != nil {
		log.Fatalf("designer client: %v", err)
	}

	defer designerConn.Close()

	aiConn, err := dial(cfg.AIAddr)

	if err != nil {
		log.Fatalf("ai client: %v", err)
	}

	defer aiConn.Close()

	eventsConn, err := dial(cfg.EventsAddr)

	if err != nil {
		log.Fatalf("events client: %v", err)
	}

	defer eventsConn.Close()

	srv := server.New(
		gatewayv1.NewGatewayClient(designerConn),
		aiv1.NewAiClient(aiConn),
		eventsv1.NewEventsClient(eventsConn),
	)

	lis, err := net.Listen("tcp", cfg.Addr)

	if err != nil {
		log.Fatalf("listen %s: %v", cfg.Addr, err)
	}

	gs := grpc.NewServer()
	gatewayv1.RegisterGatewayServer(gs, srv)

	log.Printf("gateway: nasłuch gRPC na %s | designer=%s ai=%s events=%s",
		cfg.Addr, cfg.DesignerAddr, cfg.AIAddr, cfg.EventsAddr)

	if err := gs.Serve(lis); err != nil {
		log.Fatalf("serve: %v", err)
	}
}
