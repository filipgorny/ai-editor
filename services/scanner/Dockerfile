# Build — cgo wymagane (tree-sitter), więc obraz golang z gcc.
# go.mod wymaga go >= 1.25, stąd obraz 1.26.
FROM golang:1.26-bookworm AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=1 go build -o /out/scanner ./services/scanner/cmd/scanner

# Runtime — potrzebny git (scanner woła `git` dla git path) i certyfikaty.
FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /out/scanner /usr/local/bin/scanner
COPY config/ai-architect.yaml /app/config/ai-architect.yaml

EXPOSE 50051

ENTRYPOINT ["scanner"]
