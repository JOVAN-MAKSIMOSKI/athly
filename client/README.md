# Athly Frontend

React + TypeScript + Vite setup for Athly.

## Environment

Copy `.env.example` to `.env` and adjust values if needed:

- `VITE_API_BASE_URL` (default: `http://127.0.0.1:3000`)
- `VITE_MCP_PATH` (default: `/mcp`)

## Connection Layer

- `src/connection/api.ts`: backend REST calls (currently auth login)
- `src/connection/mcpClient.ts`: MCP JSON-RPC initialization and tool discovery
- `src/connection/config.ts`: centralized frontend connection configuration

## Local Development

From workspace root:

- `npm run dev:server`
- `npm run dev:client`

Frontend runs on `http://localhost:5173` and proxies `/auth` and `/mcp` to backend `http://127.0.0.1:3000`.
