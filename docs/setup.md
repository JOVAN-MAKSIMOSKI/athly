# Setup Guide

This guide covers the fastest path to running Athly locally.

## Prerequisites

- Node.js 20+
- npm 10+
- Docker Desktop or another Docker runtime
- a running MongoDB instance
- a Google Cloud project if you want Vertex AI-backed LLM features enabled

## Install Dependencies

From the repository root:

```bash
npm install
```

The repository uses npm workspaces for the `client` and `server` packages.

## Environment Variables

Create a root `.env` file.

### Required for core server startup

```env
MONGODB_URI=mongodb://127.0.0.1:27017/athly
PORT=3000
HOST=127.0.0.1
FRONTEND_ORIGIN=http://localhost:5173
MCP_PATH=/mcp
MCP_TRANSPORT=http
```

### Required for auth

```env
JWT_SIGNTOKEN_SECRET=replace-me
JWT_REFRESHTOKEN_SECRET=replace-me-too
JWT_SIGNTOKEN_EXPIRESIN=15m
JWT_SIGNCOOKIE_EXPIRESIN=15
JWT_REFRESHTOKEN_EXPIRESIN=90d
JWT_REFRESH_COOKIE_EXPIRESIN=90
```

### Required for Vertex-backed LLM routing

```env
VERTEX_AI_PROJECT=your-gcp-project
VERTEX_AI_LOCATION=europe-west4
VERTEX_AI_MODEL=
VERTEX_AI_MODEL_LIGHT=gemini-2.5-flash-lite
VERTEX_AI_MODEL_STANDARD=gemini-2.5-flash
VERTEX_AI_MODEL_COMPLEX=gemini-2.5-pro
```

### Recommended for embeddings and search

```env
QDRANT_URL=http://127.0.0.1:6333
QDRANT_COLLECTION=athly_exercises
EMBEDDINGS_PROVIDER=google
GOOGLE_API_KEY=
GEMINI_API_KEY=
GOOGLE_EMBEDDING_MODEL=gemini-embedding-001
```

### Optional development flags

```env
NODE_ENV=development
DANGEROUSLY_OMIT_AUTH=false
QDRANT_CHECK_COMPATIBILITY=false
EMBEDDINGS_ALLOW_LOCAL_FALLBACK=true
```

## Client Environment

Create `client/.env` only if you want to override defaults.

```env
VITE_API_BASE_URL=http://127.0.0.1:3000
VITE_MCP_PATH=/mcp
VITE_MCP_ROOTS=./user-data,./workouts
```

## Start Local Services

### Start Qdrant

The repository includes a compose file for local Qdrant.

```bash
docker compose up -d
```

This exposes Qdrant on:

- `http://127.0.0.1:6333`
- gRPC port `6334`

### Start the backend

```bash
npm run dev:server
```

The server defaults to `http://127.0.0.1:3000`.

### Start the frontend

```bash
npm run dev:client
```

The client defaults to `http://localhost:5173`.

## Index Exercise Data Into Qdrant

If you want vector search and replacement flows to work against indexed exercise data:

```bash
npm run ai:index:qdrant --workspace=server
npm run ai:verify:qdrant --workspace=server
```

## Common Development Commands

```bash
npm run test
npm run dev:server
npm run dev:client
npm run ai:search:qdrant --workspace=server
```

## Troubleshooting

### Frontend cannot stay logged in

Check host consistency between frontend and backend. This project is sensitive to `localhost` versus `127.0.0.1` cookie behavior because auth uses `SameSite=Lax` cookies.

### MCP requests fail with auth errors during local development

Confirm `DANGEROUSLY_OMIT_AUTH` is not masking a configuration issue. In development, MCP auth can be bypassed depending on environment flags.

### LLM route returns `VERTEX_CONFIG_MISSING`

Set `VERTEX_AI_PROJECT` in the root `.env` file.

### Exercise replacement falls back poorly

Confirm Qdrant is running and the exercise collection has been indexed.