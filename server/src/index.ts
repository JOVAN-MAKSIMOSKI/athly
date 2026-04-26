import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { connectDB } from './database/connection.js';
import { registerExercisesTool } from './tools/exercises/index.js';
import { registerUserProfileTool } from './tools/users/index.js';
import { registerCreateWorkoutPlanTool, registerGenerateWorkoutTool, registerSplitPlannerTool } from './tools/workouts/index.js';
import {
  registerCreateUserExercisesTool,
  registerUpdateUserExercisePreferredWeightTool,
} from './tools/userExercises/index.js';
import {
  registerProgressIntermediateAdvancedTool,
  registerTrackProgressIntermediateAdvancedTool,
} from './tools/progress/index.js';
import {
  registerWorkoutCreationPrompt,
  registerWorkoutStartPrompt,
  registerOnboardingFollowupPrompt,
  registerProgressIntermediateAdvancedPrompt,
  registerUserExerciseWeightPreferencePrompt,
  registerEliteCoachSystemPrompt,
} from './prompts/index.js';
import { requireAuth } from './middleware/auth.js';
import authRouter from './routes/auth.js';
import llmRouter from './routes/llm.js';
import workoutsRouter from './routes/workouts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const MCP_PATH = process.env.MCP_PATH || '/mcp';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
const MONGODB_URI = process.env.MONGODB_URI || '';
const MCP_TRANSPORT = (process.env.MCP_TRANSPORT || 'http').toLowerCase();

type McpSessionRuntime = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
};

function summarizeMcpBody(body: unknown): Record<string, unknown> | null {
  if (!body) {
    return null;
  }

  if (Array.isArray(body)) {
    return {
      kind: 'batch',
      size: body.length,
      first: summarizeMcpBody(body[0]),
    };
  }

  if (typeof body !== 'object') {
    return { kind: typeof body };
  }

  const payload = body as Record<string, unknown>;
  return {
    kind: 'single',
    jsonrpc: payload.jsonrpc,
    id: payload.id ?? null,
    method: payload.method ?? null,
    hasParams: payload.params !== undefined,
  };
}

function isInitializeRequestBody(body: unknown): boolean {
  if (!body) {
    return false;
  }

  const messages = Array.isArray(body) ? body : [body];
  return messages.some((message) => {
    if (!message || typeof message !== 'object') {
      return false;
    }

    const payload = message as Record<string, unknown>;
    return payload.method === 'initialize';
  });
}

function createConfiguredMcpServer(): McpServer {
  const server = new McpServer({
    name: 'athly-server',
    version: '1.0.0',
  });

  registerExercisesTool(server);
  registerUserProfileTool(server);
  registerCreateUserExercisesTool(server);
  registerUpdateUserExercisePreferredWeightTool(server);
  registerCreateWorkoutPlanTool(server);
  registerGenerateWorkoutTool(server);
  registerSplitPlannerTool(server);
  registerTrackProgressIntermediateAdvancedTool(server);
  registerProgressIntermediateAdvancedTool(server);
  registerEliteCoachSystemPrompt(server);
  registerWorkoutCreationPrompt(server);
  registerWorkoutStartPrompt(server);
  registerOnboardingFollowupPrompt(server);
  registerProgressIntermediateAdvancedPrompt(server);
  registerUserExerciseWeightPreferencePrompt(server);

  return server;
}

async function startServer() {
  try {
    console.error(`Server starting on port ${PORT}...`);
    
    if (!MONGODB_URI) {
      throw new Error('MONGODB_URI environment variable is not set');
    }

    // Connect to database
    await mongoose.connect(MONGODB_URI);
    console.error('Mongoose connected');
    await connectDB();
    console.error('Database connected');
    
    const sessionRuntimes = new Map<string, McpSessionRuntime>();

    // Enforce Streamable HTTP transport across the project.
    // SSE is the server-to-client event stream used by this transport.
    if (!['sse', 'http'].includes(MCP_TRANSPORT)) {
      throw new Error('Invalid MCP_TRANSPORT. Use "http" (preferred) for MCP Streamable HTTP transport.');
    }

    const createSessionRuntime = async (): Promise<McpSessionRuntime> => {
      const server = createConfiguredMcpServer();
      let runtime: McpSessionRuntime;

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId: string) => {
          sessionRuntimes.set(sessionId, runtime);
          console.error('[MCP][SESSION][INIT]', { sessionId });
        },
      });

      runtime = { server, transport };
      await server.connect(transport);
      return runtime;
    };

    const getSessionRuntime = (req: any): McpSessionRuntime | null => {
      const sessionId = req.header('mcp-session-id');
      if (!sessionId) {
        return null;
      }

      return sessionRuntimes.get(sessionId) ?? null;
    };

    const app = createMcpExpressApp({ host: HOST });
    app.use((req, res, next) => {
      const origin = req.headers.origin;
      const isLocalOrigin =
        typeof origin === 'string' &&
        (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'));
      const allowedOrigin = isLocalOrigin ? origin : FRONTEND_ORIGIN;

      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
      res.setHeader(
        'Access-Control-Expose-Headers',
        'mcp-session-id, mcp-protocol-version'
      );
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, mcp-session-id, mcp-protocol-version, x-requested-with'
      );

      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }

      next();
    });
    app.use('/auth', authRouter);
    app.use((req, res, next) => {
      if (req.path !== MCP_PATH) {
        return next();
      }

      const startedAt = Date.now();
      const mcpSessionId = req.header('mcp-session-id') || null;
      const mcpProtocolVersion = req.header('mcp-protocol-version') || null;
      const hasAuthorization = Boolean(req.header('authorization'));

      console.error('[MCP][REQ]', {
        method: req.method,
        path: req.path,
        hasAuthorization,
        mcpSessionId,
        mcpProtocolVersion,
        body: summarizeMcpBody(req.body),
      });

      res.on('finish', () => {
        console.error('[MCP][RES]', {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          durationMs: Date.now() - startedAt,
          mcpSessionIdOut: res.getHeader('mcp-session-id') ?? null,
        });
      });

      return next();
    });
    const isDev = process.env.NODE_ENV === 'development';
    const omitAuth = process.env.DANGEROUSLY_OMIT_AUTH === 'true';
    app.use((req, res, next) => {
      if ((isDev || omitAuth) && req.path === MCP_PATH) {
        return next();
      }

      return requireAuth(req, res, next);
    });
    app.use('/llm', llmRouter);
    app.use('/workouts', workoutsRouter);
    app.get(MCP_PATH, async (req : any, res : any) => {
      const runtime = getSessionRuntime(req);
      if (!runtime) {
        res.status(404).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Session not found',
          },
          id: null,
        });
        return;
      }

      await runtime.transport.handleRequest(req, res);
    });
    app.post(MCP_PATH, async (req : any, res : any) => {
      const isInitialize = isInitializeRequestBody(req.body);
      let runtime = isInitialize ? null : getSessionRuntime(req);

      if (!runtime) {
        runtime = await createSessionRuntime();
      }

      await runtime.transport.handleRequest(req, res, req.body);
    });
    app.delete(MCP_PATH, async (req: any, res: any) => {
      const sessionId = req.header('mcp-session-id');
      if (!sessionId) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Missing mcp-session-id header',
          },
          id: null,
        });
        return;
      }

      const runtime = sessionRuntimes.get(sessionId);
      if (!runtime) {
        res.status(404).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Session not found',
          },
          id: null,
        });
        return;
      }

      sessionRuntimes.delete(sessionId);
      await runtime.transport.handleRequest(req, res);
      await runtime.transport.close();
      await runtime.server.close();
      console.error('[MCP][SESSION][CLOSED]', { sessionId });
    });

    app.listen(Number(PORT), HOST, () => {
      console.error(`MCP Streamable HTTP server running at http://${HOST}:${PORT}${MCP_PATH} (SSE-enabled)`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
