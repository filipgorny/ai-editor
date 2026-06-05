# Generyczny obraz dla bezstanowych serwisów Go (bez cgo).
# Serwis wybierany przez build-arg SERVICE, np. gateway / ai / events / designer /
# scripting / logs / filer. Scanner ma WŁASNY Dockerfile (cgo / tree-sitter).
#
# Budowanie ręczne:
#   docker build -f services/Dockerfile --build-arg SERVICE=gateway -t ai-architect-gateway .
ARG SERVICE

FROM golang:1.26-bookworm AS build
ARG SERVICE

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -o /out/service ./services/${SERVICE}/cmd/${SERVICE}

# Runtime — ca-certificates + git (część serwisów woła `git` / wychodzi po HTTPS).
FROM debian:bookworm-slim
ARG SERVICE

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

# Serwis `ai` woła Claude Code CLI (`claude -p`) dla dostawcy "Claude (headless)".
# Tylko ten obraz dostaje Node.js + CLI — reszta serwisów Go go nie potrzebuje.
RUN if [ "$SERVICE" = "ai" ]; then \
      apt-get update \
      && apt-get install -y --no-install-recommends curl \
      && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
      && apt-get install -y --no-install-recommends nodejs \
      && npm install -g @anthropic-ai/claude-code \
      && rm -rf /var/lib/apt/lists/*; \
    fi

WORKDIR /app

COPY --from=build /out/service /usr/local/bin/service
COPY config/ai-architect.yaml /app/config/ai-architect.yaml

ENTRYPOINT ["service"]
