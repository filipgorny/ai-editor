// Package server udostępnia skaner po gRPC.
package server

import (
	scannerv1 "github.com/filipgorny/ai-architect/proto/scanner/v1"
	"github.com/filipgorny/ai-architect/services/scanner/internal/scan"
)

// Server implementuje scannerv1.ScannerServer.
type Server struct {
	scannerv1.UnimplementedScannerServer

	scanner *scan.Scanner
}

func New(sc *scan.Scanner) *Server {
	return &Server{scanner: sc}
}

// Scan uruchamia skan wierzchni i strumieniuje zdarzenia do klienta.
func (s *Server) Scan(req *scannerv1.ScanRequest, stream scannerv1.Scanner_ScanServer) error {
	emit := func(ev *scannerv1.ScanEvent) error {
		return stream.Send(ev)
	}

	return s.scanner.Run(stream.Context(), req.GetPath(), emit)
}

// ScanApp robi głęboki skan katalogu pojedynczego serwisu (po ścieżce).
func (s *Server) ScanApp(req *scannerv1.ScanAppRequest, stream scannerv1.Scanner_ScanAppServer) error {
	emit := func(ev *scannerv1.ScanEvent) error {
		return stream.Send(ev)
	}

	return s.scanner.ScanAppDir(stream.Context(), req.GetPath(), emit)
}
