# Engineering Decisions

This document captures the major architectural choices visible in the current Athly codebase.

## 1. Monorepo with npm workspaces

The repository uses a root workspace with `client` and `server` packages.

Why:

- shared dependency management
- one top-level install
- simpler local development for a tightly-coupled frontend and backend

## 2. TypeScript on both client and server

Athly uses TypeScript end to end.

Why:

- better schema alignment across UI, API, and tool layers
- safer refactoring of prompt, route, and domain contracts

## 3. MCP for structured AI workflows

The project uses the Model Context Protocol so the assistant can discover and call server-defined tools through a standardized interface.

Why:

- tools provide validation boundaries around AI actions
- elicitation flows make missing inputs explicit in the UI
- system prompts and tool schemas stay centralized on the server side

## 4. Cookie-based JWT auth

Athly uses access and refresh tokens stored as HTTP-only cookies.

Why:

- improves frontend ergonomics for authenticated requests
- supports refresh-token rotation and server-side revocation

Tradeoff:

- local development must stay consistent about `localhost` versus `127.0.0.1` because cookie behavior matters

## 5. MongoDB for operational data

MongoDB is the primary operational store for users, workouts, and exercise entities.

Why:

- flexible document shapes fit evolving workout and user-profile data well
- Mongoose models are already central to the backend design

## 6. Qdrant for vector retrieval

Qdrant is used for exercise retrieval and replacement use cases.

Why:

- semantic search is a better fit than exact matching for natural-language replacement queries
- vector search complements, rather than replaces, the core MongoDB store

Tradeoff:

- vector search adds indexing and infrastructure overhead, so the backend includes database fallback behavior for some flows

## 7. Vertex model routing instead of a single fixed model

The LLM route selects between light, standard, and complex Vertex models depending on request shape.

Why:

- cheaper requests can stay on lighter models
- more complex tool-rich requests can use stronger models when needed

## 8. Short root README, deeper docs elsewhere

The repository now uses a short root README supported by dedicated files in `docs/` and the existing long-form documentation.

Why:

- fast first impression for recruiters and collaborators
- lower maintenance cost for the root document
- easier to expand specific topics without bloating the overview