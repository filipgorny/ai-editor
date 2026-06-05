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
	filerv1 "github.com/filipgorny/ai-architect/proto/filer/v1"
	gatewayv1 "github.com/filipgorny/ai-architect/proto/gateway/v1"
	gitv1 "github.com/filipgorny/ai-architect/proto/git/v1"
	logsv1 "github.com/filipgorny/ai-architect/proto/logs/v1"
	scannerv1 "github.com/filipgorny/ai-architect/proto/scanner/v1"
	scriptingv1 "github.com/filipgorny/ai-architect/proto/scripting/v1"
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

	filerConn, err := dial(cfg.FilerAddr)

	if err != nil {
		log.Fatalf("filer client: %v", err)
	}

	defer filerConn.Close()

	scriptingConn, err := dial(cfg.ScriptingAddr)

	if err != nil {
		log.Fatalf("scripting client: %v", err)
	}

	defer scriptingConn.Close()

	logsConn, err := dial(cfg.LogsAddr)

	if err != nil {
		log.Fatalf("logs client: %v", err)
	}

	defer logsConn.Close()

	scannerConn, err := dial(cfg.ScannerAddr)

	if err != nil {
		log.Fatalf("scanner client: %v", err)
	}

	defer scannerConn.Close()

	gitConn, err := dial(cfg.GitAddr)

	if err != nil {
		log.Fatalf("git client: %v", err)
	}

	defer gitConn.Close()

	srv := server.New(
		gatewayv1.NewGatewayClient(designerConn),
		aiv1.NewAiClient(aiConn),
		eventsv1.NewEventsClient(eventsConn),
		filerv1.NewFilerClient(filerConn),
		scriptingv1.NewScriptingClient(scriptingConn),
		logsv1.NewLogsClient(logsConn),
		scannerv1.NewScannerClient(scannerConn),
		gitv1.NewGitClient(gitConn),
	)

	lis, err := net.Listen("tcp", cfg.Addr)

	if err != nil {
		log.Fatalf("listen %s: %v", cfg.Addr, err)
	}

	gs := grpc.NewServer()
	gatewayv1.RegisterGatewayServer(gs, srv)

	log.Printf("gateway: nasłuch gRPC na %s | designer=%s ai=%s events=%s filer=%s scripting=%s",
		cfg.Addr, cfg.DesignerAddr, cfg.AIAddr, cfg.EventsAddr, cfg.FilerAddr, cfg.ScriptingAddr)

	if err := gs.Serve(lis); err != nil {
		log.Fatalf("serve: %v", err)
	}
}
