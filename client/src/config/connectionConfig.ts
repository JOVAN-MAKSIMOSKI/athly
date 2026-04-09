// Centralized runtime configuration used by non-UI orchestration layers.
const DEFAULT_API_BASE_URL =
  typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : 'http://127.0.0.1:3000'

export const connectionConfig = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL,
  mcpPath: import.meta.env.VITE_MCP_PATH || '/mcp',
  allowedRootPaths: (import.meta.env.VITE_MCP_ROOTS || './user-data,./workouts')
    .split(',')
    .map((entry: string) => entry.trim())
    .filter((entry: string) => entry.length > 0),
}
