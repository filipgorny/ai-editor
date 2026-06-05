// Package server udostępnia eventy po gRPC.
package server

import (
	"context"

	eventsv1 "github.com/filipgorny/ai-architect/proto/events/v1"
	"github.com/filipgorny/ai-architect/services/events/internal/store"
)

type Server struct {
	eventsv1.UnimplementedEventsServer

	store *store.Store
}

func New(st *store.Store) *Server {
	return &Server{store: st}
}

func (s *Server) Publish(ctx context.Context, in *eventsv1.Event) (*eventsv1.Event, error) {
	e, err := s.store.Publish(ctx, store.Event{
		Type: in.GetType(), Title: in.GetTitle(), Body: in.GetBody(),
		AppID: in.GetAppId(), File: in.GetFile(), NodeID: in.GetNodeId(),
		CreatedAt: in.GetCreatedAt(),
	})

	if err != nil {
		return nil, err
	}

	return toProto(e), nil
}

func (s *Server) List(ctx context.Context, in *eventsv1.ListRequest) (*eventsv1.EventList, error) {
	evs, err := s.store.List(ctx, in.GetFile(), in.GetNodeId(), in.GetAppId(), int(in.GetLimit()))

	if err != nil {
		return nil, err
	}

	out := &eventsv1.EventList{}

	for _, e := range evs {
		out.Events = append(out.Events, toProto(e))
	}

	return out, nil
}

func toProto(e store.Event) *eventsv1.Event {
	return &eventsv1.Event{
		Id: e.ID, Type: e.Type, Title: e.Title, Body: e.Body,
		AppId: e.AppID, File: e.File, NodeId: e.NodeID, CreatedAt: e.CreatedAt,
	}
}
