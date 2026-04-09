# Athly Client (React) Development Guidelines

## Overview
This document outlines architecture, patterns, and best practices for the Athly client application.

## Project Context

**Technology Stack:** MERN (MongoDB, Express, React, Node.js) AI Agent project using the Model Context Protocol (MCP).

- **Frontend:** React with Vite (MCP Host/Client)
- **Backend:** Node.js/Express (MCP Server)
- **Protocol:** Model Context Protocol for AI-powered agent communication

## Project Structure

- `/client` - React frontend (MCP Client)
- `/server` - Node.js/Express backend (MCP Server)
- `/shared` - JSON schemas for workout data and MCP custom tool definitions

## References
- **Backend/MCP Rules:** See [INSTRUCTIONS.md](INSTRUCTIONS.md)
- **Setup & Installation:** See [INSTRUCTIONS.md](INSTRUCTIONS.md#installation)

## Troubleshooting Tip (Cannot Find Module)

If TypeScript reports `Cannot find module './views/NotFoundPage.tsx'` (or similar) in client routing code:

- Prefer extensionless imports for local TS/TSX modules:
  - `import('./views/NotFoundPage')`
  - `import { AppLayout } from './views/AppLayout'`
- Confirm relative paths from the current file are correct.
- Keep route page imports consistent in a single folder strategy (`src/ui/views` or `src/views`) to avoid path confusion.
- Validate with `npm run build` from `client/`.

---

# General Rules

## Collaboration Preferences (Jovan)

- When a prompt ends with a question mark, answer only and do not perform actions.
- Before a larger single code update, provide a brief implementation plan first.
- Do not start code changes with missing context.
- When making code changes, include comments describing the changes.

- **Follow these instructions as the default architecture and ruleset**
- **If you believe a better solution exists outside this scope:**
  - Explicitly suggest the alternative
  - Explain why it may be better
  - Wait for approval before implementing
- **Always briefly explain decisions and trade-offs** when generating non-trivial code
- **Prefer clarity, predictability, and maintainability** over clever abstractions

---

# MCP Coding Guidelines

## MCP Architecture Boundaries (Required)

These rules are mandatory and override conflicting examples.

1. **Do not keep MCP protocol logic inside React components or hooks**
  - Components/hooks may only consume UI-ready state and callbacks.
  - Protocol handlers, client lifecycle, request routing, and sampling orchestration must live in orchestration/service modules.

2. **Do not treat MCP client as a UI concern**
  - Instantiate and manage MCP clients in orchestration code (for example: `src/connection/` or `src/services/`).
  - UI must not own transport setup, handler registration, or protocol lifecycle.

3. **Do not treat server-declared prompts as server-executed logic**
  - Prompt declarations on the server are metadata/templates.
  - The host application composes messages and sends them to the LLM.
  - Server prompt registration does not execute the prompt by itself.

4. **Keep responsibility split explicit**
  - **Server:** declares tools/resources/prompts and business capabilities.
  - **Host/client orchestration:** resolves prompt templates + runtime context, applies safety policy, invokes sampling/tool flows.
  - **React UI:** presents state, captures user input, and renders approval/elicitation UX.

### Forbidden Patterns

- Registering MCP request handlers directly inside React components/hooks.
- Creating MCP client instances inside component render/effect logic.
- Describing server prompts as "executed by server" instead of used by host when composing LLM requests.

## Host-Driven Agent Architecture (Mandatory)

These rules are required for all new features and refactors.

### Rule 1 — The Host Owns Intelligence

- **Host owns:** LLM calls, tool-use decisions, orchestration, memory.
- **Server owns:** capability exposure and deterministic execution.
- The server does not "think" and must not contain agent reasoning behavior.

### Rule 2 — Never Mix UI and Orchestration

- UI components must not call MCP directly.
- UI components must not run tool loops.
- UI components must not inject prompts.
- UI renders state and emits intents; agent/orchestrator performs reasoning.

### Rule 3 — One Directional Dependencies Only

Required dependency flow:

```text
UI
 ↓
Agent
 ↓
LLM + MCP
 ↓
Transport
```

- Never invert this dependency direction.

### Rule 4 — Servers Must Be Model-Agnostic

- Switching LLM providers (for example GPT ↔ Claude) must not require server changes.
- Server code must not depend on model vendor, model name, or provider SDK behavior.

### Rule 5 — Agent Controls the Loop

- Only one module is allowed to interpret tool calls, call tools, re-prompt the LLM, and stop infinite loops.
- That module is `agentLoop.ts` (or a single equivalent orchestrator entrypoint).
- Never place loop control in React, MCP transport modules, or generic utilities.

### Rule 6 — Transport Is Dumb

- MCP client responsibilities: send JSON-RPC requests, return responses.
- LLM client responsibilities: send provider requests, return responses/streams.
- Transport modules must not contain business rules or orchestration logic.

### Rule 7 — Prompt Templates Are Metadata

- Server prompts are templates discovered via handshake/registry.
- Host injects prompt content into LLM context at runtime.
- Prompts do not execute by themselves on the server.

### Rule 8 — Design for Swap-ability and Headless Execution

Every architecture decision must pass these checks:

- Can we swap the UI layer without rewriting orchestration?
- Can we swap LLM providers without server changes?
- Can we add a second MCP server without rewriting UI?
- Can the agent run headless (without React)?

If any answer is **No**, boundaries must be refactored before feature completion.

## Transport Standard

- **Use MCP Streamable HTTP transport** as the project standard.
- **Environment value:** `MCP_TRANSPORT=http`.
- **Client transport:** `StreamableHTTPClientTransport`.
- **Note:** SSE is the event-stream mechanism used internally by Streamable HTTP.

## SDK & Initialization

- **Always use the official `@modelcontextprotocol/sdk`** from npm.
- Client-side initialization must include capabilities for:
  - `sampling` - LLM message creation and sampling
  - `roots` - File system resource exposure

## Sampling (LLM Calls)

**Security requirement:** All `sampling/createMessage` requests to the LLM must include a **Human-in-the-loop check** before execution.

- Present a confirmation modal in the UI
- Show the user what the agent intends to do
- Require explicit user approval before invoking LLM calls
- Log all sampling requests for audit purposes
- **Consider:** Whether to include a `tools` array inside the sampling request so custom tools can be used by the LLM during message generation

## Roots (File System Access)

**Security requirement:** Restrict file system exposure.

- **Only expose directories:** `./user-data` and `./workouts` to the server
- **Never expose:**
  - Root system directories (`/`, `C:\`, etc.)
  - Sensitive folders (`.git`, `node_modules`, `.env`, etc.)
  - Parent directories of the application
- Configure roots in `mcpClient.ts` during initialization

## Elicitation Pattern (Schema-Driven UI)

The Client must be "logic-blind" and dynamically generate UI from server-provided schemas.

### Schema-Driven UI Implementation

**Principle:** The server defines what data is needed via `requestedSchema` (JSON Schema), and the client dynamically generates UI components (inputs, toggles, selects) to collect that data.

**Benefits:**
- Frontend doesn't need hardcoded forms for specific tools
- Server controls data structure requirements
- Easy to iterate tool inputs without frontend changes

**Implementation:**
```typescript
// Server provides schema
const requestedSchema = {
  type: 'object',
  properties: {
    experience: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
    weight: { type: 'number', minimum: 0 }
  },
  required: ['experience']
};

// Client renders dynamically
function SchemaForm({ schema, onSubmit }) {
  const fields = Object.entries(schema.properties);
  return fields.map(([key, fieldSchema]) => {
    if (fieldSchema.enum) {
      return <select key={key} name={key} required={schema.required?.includes(key)} />
    }
    if (fieldSchema.type === 'number') {
      return <input key={key} type="number" name={key} min={fieldSchema.minimum} />
    }
    // ... handle other types
  });
}
```

### Global Listener Pattern

**Requirement:** Initialize request handlers for both `elicitation/create` and `sampling/createMessage` in a dedicated orchestration module that starts once at app bootstrap.

**Why:** This keeps protocol responsibilities outside React while keeping handlers globally active across all routes.

**Pattern - Orchestrator + UI Bridge:**
```typescript
// src/connection/mcpOrchestrator.ts
// Owns client lifecycle + request handlers (non-React module)
export function startMcpOrchestrator(deps: {
  client: McpClient;
  uiBridge: {
    openElicitation: (request: ElicitationRequest) => Promise<ElicitationResponse>;
    openSamplingApproval: (request: SamplingRequest) => Promise<SamplingResponse>;
  };
}) {
  const { client, uiBridge } = deps;

  client.setRequestHandler('elicitation/create', async (request) => {
    return uiBridge.openElicitation(request);
  });

  client.setRequestHandler('sampling/createMessage', async (request) => {
    return uiBridge.openSamplingApproval(request);
  });
}

// React layer only renders modal state from a store/context bridge.
// React does not register protocol handlers directly.
```

### Schema Rendering & Type Validation

**Principle:** The client uses a dynamic form builder to render inputs based on the `requestedSchema` provided by the server, and validates types before returning.

**Dynamic Form Builder:**
```typescript
// src/components/DynamicFormBuilder.tsx
interface DynamicFormProps {
  schema: JSONSchema;
  onSubmit: (data: Record<string, any>) => void;
  onCancel: () => void;
}

export function DynamicFormBuilder({ schema, onSubmit, onCancel }: DynamicFormProps) {
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = () => {
    // Type-cast and validate before submission
    const validatedData = validateAndCastTypes(formData, schema);
    if (validatedData.valid) {
      onSubmit(validatedData.data);
    } else {
      setErrors(validatedData.errors);
    }
  };

  const renderField = (key: string, fieldSchema: any) => {
    const fieldType = fieldSchema.type;

    if (fieldSchema.enum) {
      return (
        <select
          key={key}
          name={key}
          value={formData[key] ?? ''}
          onChange={(e) => setFormData({ ...formData, [key]: e.target.value })}
          required={schema.required?.includes(key)}
        >
          <option value="">Select {key}...</option>
          {fieldSchema.enum.map((val: string) => (
            <option key={val} value={val}>
              {val}
            </option>
          ))}
        </select>
      );
    }

    if (fieldType === 'number') {
      return (
        <input
          key={key}
          type="number"
          name={key}
          value={formData[key] ?? ''}
          onChange={(e) => setFormData({ ...formData, [key]: e.target.value })}
          min={fieldSchema.minimum}
          max={fieldSchema.maximum}
          required={schema.required?.includes(key)}
        />
      );
    }

    if (fieldType === 'boolean') {
      return (
        <input
          key={key}
          type="checkbox"
          name={key}
          checked={formData[key] ?? false}
          onChange={(e) => setFormData({ ...formData, [key]: e.target.checked })}
        />
      );
    }

    // Default: text input
    return (
      <input
        key={key}
        type="text"
        name={key}
        value={formData[key] ?? ''}
        onChange={(e) => setFormData({ ...formData, [key]: e.target.value })}
        required={schema.required?.includes(key)}
      />
    );
  };

  return (
    <form>
      {schema.properties &&
        Object.entries(schema.properties).map(([key, fieldSchema]: any) =>
          renderField(key, fieldSchema)
        )}
      {Object.entries(errors).map(([key, error]) => (
        <p key={key} className="error">
          {error}
        </p>
      ))}
      <button type="button" onClick={handleSubmit}>
        Submit
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

// Type validation and casting helper
function validateAndCastTypes(
  data: Record<string, any>,
  schema: JSONSchema
): { valid: boolean; data?: Record<string, any>; errors?: Record<string, string> } {
  const errors: Record<string, string> = {};
  const casted: Record<string, any> = {};

  for (const [key, value] of Object.entries(data)) {
    const fieldSchema = (schema.properties as any)?.[key];
    if (!fieldSchema) continue;

    try {
      if (fieldSchema.type === 'number') {
        const num = Number(value);
        if (isNaN(num)) throw new Error('Must be a number');
        if (fieldSchema.minimum !== undefined && num < fieldSchema.minimum) {
          throw new Error(`Must be at least ${fieldSchema.minimum}`);
        }
        casted[key] = num;
      } else if (fieldSchema.type === 'boolean') {
        casted[key] = value === 'true' || value === true;
      } else {
        casted[key] = String(value);
      }
    } catch (error) {
      errors[key] = `${key}: ${error.message}`;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, data: casted };
}
```

---

## MCP Implementation Guardrails

### 1. Capability Handshake
- **Constraint:** Always initialize the `McpClient` with explicit capabilities.
- **Goal:** Prevent "Capability Mismatch" errors.
- **Requirement:** Ensure `sampling: {}` and `roots: {}` are present in the initialization object.

### 2. Async Request Handling & Type Casting

**Constraint:** Never allow a sampling request to block indefinitely.
- **Goal:** Prevent "Thread Blocking" if a user is away from the screen.
- **Requirement:** Use `AbortController` or `setTimeout` logic within the `setRequestHandler` to provide a fallback or error if the user doesn't respond within 60 seconds.

**Type Casting Requirement:** The client must ensure data returned in the accept response matches the type defined in `requestedSchema`.
- Convert string inputs to numbers or booleans as required
- Validate array/object structures before returning
- Never return raw form data—transform it to match schema types

**Example:**
```typescript
async function handleElicitationResponse(formData: Record<string, any>, schema: JSONSchema) {
  const typedResponse = {};
  for (const [key, value] of Object.entries(formData)) {
    const fieldSchema = schema.properties[key];
    
    if (fieldSchema.type === 'number') {
      typedResponse[key] = Number(value);
    } else if (fieldSchema.type === 'boolean') {
      typedResponse[key] = value === 'true' || value === true;
    } else {
      typedResponse[key] = value; // Keep as-is for strings
    }
  }
  
  return typedResponse; // Now matches schema types
}
```

### 3. Filesystem Security (Roots)
- **Constraint:** Use strict whitelisting for directory access.
- **Goal:** Avoid "Sensitive Root Exposure" (e.g., exposing `.env` or `node_modules`).
- **Requirement:** Only provide paths related to `./workout-logs` or `./user-profiles`.

### 4. Prompt Engineering (Context Mixing)
- **Constraint:** Always wrap server-provided `systemPrompt` with local safety constraints.
- **Goal:** Prevent "Context Mixing" or prompt injection.
- **Requirement:** Prepend or append specific app rules, such as: "Safety First: Never suggest exercises if the user reports joint pain."

---

## System Instructions Registration (MCP)

I want to standardize how MCP servers declare their "Identity and Rules." Add a reusable TypeScript helper on the server that registers a system-level prompt named `system-instructions`.

- **Function signature:** `registerSystemInstructions(server: McpServer, instructions: string): void`
- **Behavior:** Registers an MCP prompt with name `system-instructions` and sets a metadata flag `isSystem: true` in the prompt description so clients can automatically load it as the base system message.

Example implementation (server/src/prompts/registerSystemInstructions.ts):

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export function registerSystemInstructions(server: McpServer, instructions: string) {
  server.registerPrompt('system-instructions', {
    title: 'System Instructions',
    description: 'Shared system instructions for MCP servers.',
    isSystem: true as unknown as boolean,
  } as any, async () => ({
    messages: [{ role: 'system', content: { type: 'text', text: instructions } }],
  }));
}
```

Usage pattern:

- Create your system message (for example, the Elite Coach instructions) as a single string constant.
- Call `registerSystemInstructions(server, YOUR_INSTRUCTIONS)` during prompt registration.

Example (server/src/prompts/eliteCoachSystem.prompt.ts):

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSystemInstructions } from './registerSystemInstructions.js';

const ELITE_COACH_SYSTEM_PROMPT = `...`; // your system prompt text

export function registerEliteCoachSystemPrompt(server: McpServer) {
  registerSystemInstructions(server, ELITE_COACH_SYSTEM_PROMPT);
}
```

This approach keeps system prompts consistent across servers and makes it easy for clients to detect and auto-load the authoritative system message.

Important: this registration declares prompt metadata/template. It does not execute the prompt on the server.

### Client-Side System Prompt Enforcement

**File:** `client/src/utils/systemPromptEnforcer.ts`

To ensure the system prompt (Elite Coach instructions) is always prepended to every LLM sampling call:

#### 1. Initialize on app startup (in orchestration bootstrap)

```typescript
import { initializeSystemInstructions } from '../utils/systemPromptEnforcer';

// In bootstrap/orchestrator startup:
const systemInstructions = await initializeSystemInstructions(mcpClient);
cacheSystemInstructions(systemInstructions);
```

#### 2. Before every LLM sampling call, prepend system instructions

```typescript
import { prependSystemInstructions } from '../utils/systemPromptEnforcer';

// When making a sampling/createMessage request:
const messagesWithSystem = await prependSystemInstructions(
  mcpClient,
  userMessages,     // Your conversation messages
  systemInstructions // Cached from step 1
);

// Now pass messagesWithSystem to your LLM instead of raw userMessages
const response = await mcpClient.sampling.createMessage({
  messages: messagesWithSystem,
  // ... other sampling params
});
```

#### 3. Helper Functions Reference

- **`fetchSystemInstructions(client)`** – Fetch system instructions from the server. Returns the system prompt text or null.
- **`prependSystemInstructions(client, messages, systemInstructions?)`** – Prepend system message to message list. Returns new message array with system message at position 0.
- **`initializeSystemInstructions(client)`** – One-time initialization call. Fetches and caches system instructions.

#### Why This Approach Works

- The system message is always at position 0 (highest priority for the LLM)
- Client-side control ensures consistent enforcement across all sampling requests
- Server registration (`system-instructions` prompt) keeps the source of truth centralized
- Easy to iterate on system prompt without changing client code—just update the server constant
- Protocol enforcement remains in orchestration modules, not React component/hook logic

---

# Client Architecture

## Recommended Host-Orchestrator Structure

```text
root/
├─ server/                     # Your MCP Server implementation
│   ├─ tools/                  # Server-side tools
│   ├─ resources/              # Server-side resources
│   ├─ prompts/                # Server-side MCP prompt templates
│   └─ index.ts
│
└─ client/                     # Your “Host” application
  ├─ src/
  │   ├─ ui/                 # React components (UI only)
  │   ├─ core/               # Core orchestration logic
  │   │   ├─ llm/            # LLM interaction / prompt construction
  │   │   ├─ mcp/            # MCP client code
  │   │   │   ├─ client.ts   # MCP client setup
  │   │   │   └─ registry.ts # Client-side discovery of server capabilities
  │   │   └─ agent/          # Agent planning/execution loops
  │   ├─ state/              # App & conversation state
  │   └─ config/             # Config and constants
  └─ ...
```

## Client Folder Structure
```
client/
├── src/
│   ├── components/        # Reusable UI components
│   ├── hooks/             # Custom React hooks
│   ├── pages/             # Page-level components
│   ├── services/
│   │   └── mcpClient.ts   # MCP communication layer (Host/Client)
│   ├── types/             # TypeScript type definitions
│   ├── utils/             # Utility functions
│   ├── styles/            # Global styles
│   └── App.tsx
├── public/
└── package.json

See [Project Context](#project-context) above for full repository structure.

---

# Core Principles

1. **UI is stateless regarding business logic** - Never contain business truth in the UI
2. **Single source of truth** - Server/MCP is the source of truth, UI is presentation
3. **Clean separation** - Component logic separate from data fetching and state management
4. **Type safety** - Use TypeScript for all code
5. **Error handling** - Graceful degradation and user feedback

---

# State Management & Data Fetching

## State Boundary
Only these cross from MCP to UI:
- User messages and action intents
- Current view identifiers
- Selected IDs
- Lightweight UI hints
- Optional conversation reference

**DO NOT store:**
- Business calculations
- Derived metrics
- Authorization logic
- Business rules

## MCP Client Communication

**File:** `src/services/mcpClient.ts`

This service handles all communication with the backend MCP server. It should:
- Manage tool invocations
- Handle prompt execution
- Provide resource access
- Manage connection lifecycle

**Example pattern:**
```typescript
// mcpClient.ts - only orchestrates, does NOT compute
async function callTool(toolName: string, args: object) {
  // Validate input
  // Call MCP server
  // Handle response/error
  return result;
}

// In component - only consumes, does NOT transform
const { data, isLoading, error } = useQuery(() => mcpClient.getTool(...));
```

---

# Component & Architecture Rules

## Component Structure

**DO:**
- One component per file
- Props clearly typed via interfaces
- Separated concerns (UI vs logic)
- Reusable and composable
- One component = one responsibility

**DON'T:**
- Mix business logic with UI
- Perform calculations in components
- Store business state locally
- Make direct API calls from components

## Performance Rules

**Large or slow components must be:**
- Code-split
- Lazy-loaded
- Or passed as children to avoid unnecessary re-renders

## Prop Drilling

**Avoid prop-drilling beyond 2 levels**
- If you need to pass props deeper than 2 levels, escalate to:
  - Context API
  - URL state (query params)
  - State management solution (Redux)

## Props Pattern
```typescript
interface ComponentProps {
  // Data from server/parent
  id: string;
  label: string;
  
  // UI hints (lightweight)
  isSelected?: boolean;
  isLoading?: boolean;
  
  // Callbacks
  onSelect?: (id: string) => void;
  onUpdate?: (data: T) => void;
}
```

---

# Routing

## Structure & Setup

- Use a `pages/` folder for route-level components
- Always implement:
  - Lazy-loaded routes
  - A `NotFound` fallback page
- Use an `AppLayout` component and follow the AppLayout pattern to avoid duplication

## Route Components

- Route components must NOT contain heavy business logic
- Keep routing layer thin—fetch data, render UI, delegate logic

---

# Hooks

## Custom Hooks

Keep hooks focused on a single responsibility:

- `useAuth()` - User authentication state
- `useQuery()` - Data fetching
- `useMutation()` - Data mutations
- `useForm()` - Form state management
- `useLocalStorage()` - Persistent UI state

**DO NOT:**
- Put business logic in hooks
- Perform calculations in hooks
- Store derived state

---

# Types

## Type Organization

**File:** `src/types/`

```
types/
├── api.types.ts         # API response/request types
├── domain.types.ts      # Business domain types (mirror server)
├── ui.types.ts          # UI-specific types
└── index.ts             # Re-exports
```

**Import from server schemas** where possible to stay in sync with backend.

---

## Common Pitfalls & Guardrails

### Type Casting

**Requirement:** Helper functions must validate and cast types before returning data to tools.

**Why:** Raw form inputs are always strings. Tools expect properly-typed values (numbers, booleans, enums).

**Pattern:**
```typescript
// WRONG: Returning form data as-is
const formData = { weight: "85", isInjured: "true" }; // All strings
return formData; // Tool receives strings, expects number/boolean

// RIGHT: Casting before return
const casted = {
  weight: Number(formData.weight), // Now: 85 (number)
  isInjured: formData.isInjured === 'true', // Now: true (boolean)
};
return casted;
```

### Error Handling & Cancellation

**Requirement:** Every protocol-level `await` must be wrapped in try/catch. If a user cancels or declines, the helper must return a clear signal to prevent partial or corrupted data.

**Pattern:**
```typescript
// Cancellation Signal Class
export class OperationCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperationCancelledError';
  }
}

// In helper
async function ensureParams(ctx, args, requirements) {
  for (const [key, req] of Object.entries(requirements)) {
    if (!args[key]) {
      try {
        const response = await ctx.elicitation.create({ ... });
        
        if (response.action === 'cancel') {
          throw new OperationCancelledError(`User cancelled ${key} elicitation`);
        }
      } catch (error) {
        if (error instanceof OperationCancelledError) {
          throw error; // Propagate to tool - tool decides what to do
        }
        // Handle other errors
      }
    }
  }
}

// In tool
async function handleTool(args, ctx) {
  try {
    const clean = await ensureParams(ctx, args, requirements);
    // Continue normally
  } catch (error) {
    if (error instanceof OperationCancelledError) {
      // User cancelled - return gracefully
      return { error: error.message, isError: true };
    }
    // Handle other errors
    return errorResponse(error.message);
  }
}
```

### No Hardcoding

**Requirement:** Ensure prompts and schemas are passed as variables to helpers, keeping helpers purely functional and project-agnostic.

**Pattern:**
```typescript
// WRONG: Hardcoded prompt inside helper
export async function ensureParams(ctx, args, requirements) {
  const response = await ctx.elicitation.create({
    message: "Please provide experience level", // Hardcoded!
    requestedSchema: someSchema,
  });
}

// RIGHT: Accept prompt as variable
export async function ensureParams(ctx, args, requirements) {
  for (const [key, req] of Object.entries(requirements)) {
    const response = await ctx.elicitation.create({
      message: req.message, // From requirement
      requestedSchema: buildSchema(req), // Built from requirement
    });
  }
}

// Tool defines the message
const cleanData = await ensureParams(ctx, args, {
  experienceLevel: {
    type: 'enum',
    enum: ['beginner', 'intermediate', 'advanced'],
    required: true,
    message: 'What is your fitness experience?' // Tool controls messaging
  }
});
```

---

## Human-in-the-Loop & Elicitation UX

### Core Requirements

1. **Visibility:** All elicitation events must be visible to the user
   - Don't attempt to "auto-fill" elicitation requests in a way that bypasses user awareness
   - Always show the UI modal/form when data is requested

2. **Context Preservation:** When eliciting information, include a clear `message` field explaining:
   - Why the data is needed
   - What it will be used for
   - How it affects the user's experience

   **Example:**
   ```typescript
   {
     message: "To personalize your workout plan, we need to know your experience level. This helps us select appropriate exercises and progression rates.",
     requestedSchema: experienceSchema
   }
   ```

3. **Decline & Cancel Handling:** Users should always be able to:
   - Cancel the elicitation modal
   - Decline to provide data
   - These actions should flow gracefully to the server

---
# Error Handling

## Error Boundaries

Wrap feature sections with error boundaries to catch rendering errors:

```typescript
<ErrorBoundary fallback={<ErrorUI />}>
  <YourComponent />
</ErrorBoundary>
```

## Network Errors

Always handle MCP communication failures gracefully:

```typescript
try {
  const result = await mcpClient.callTool(...);
} catch (error) {
  // Show user-friendly message
  // Log for debugging
  // Fallback UI
}
```

---

# Styling

## Default

- **Default styling:** Tailwind CSS

## Alternative Styling

If styling complexity becomes hard to manage:
- Suggest styled-components
- Explain why
- Wait for approval before introducing it

**DO NOT mix multiple styling paradigms without approval.**

## General Guidelines

- Responsive design first
- Accessibility considerations

# Performance & Memoization

## When to Use useMemo / useCallback

Use `useMemo` / `useCallback` only when justified.

**Valid cases:**
1. Prevent wasted renders (with `React.memo`)
2. Avoid expensive recalculations
3. Stabilize dependencies of other hooks

**If used outside these cases:**
- Explain why
- Ask for permission before implementing

---

# Testing

**TO BE ADDED:** Testing strategy, unit tests, integration tests, E2E tests

---

# Performance

## Optimization

- Lazy load routes
- Memoize expensive components (`React.memo`)
- Use `useCallback` for stable function references
- Debounce/throttle event handlers
- Code split by feature

---

# Accessibility (A11y)

## Requirements

- Semantic HTML
- Keyboard navigation support
- ARIA labels where needed
- Color contrast compliance
- Screen reader testing

---

# Common Patterns

## Loading States
```typescript
if (isLoading) return <LoadingSpinner />;
if (error) return <ErrorMessage error={error} />;
return <Content data={data} />;
```

## Empty States
Always provide meaningful empty state UI with guidance to user.

---

# Troubleshooting

### MCP Connection Failed
- Check server is running: `npm run dev --workspace=server`
- Verify MCP configuration in `mcpClient.ts`
- Check browser console for errors

### Type Errors
- Ensure types match server schemas
- Run `npm run type-check`
- Check TypeScript version compatibility

---

# Code Splitting

## Rules

- **All route components must be lazy-loaded**
- **Prefer dynamic imports over monolithic bundles**
- Use `React.lazy()` + `Suspense` for route-based code splitting

---

# Integration Checklist

Before shipping a feature:
- [ ] No business logic in components
- [ ] All server calls go through `mcpClient.ts`
- [ ] Types match server definitions
- [ ] Error states handled
- [ ] Loading states implemented
- [ ] Accessibility reviewed
- [ ] Mobile responsive
- [ ] Tested in browser
- [ ] Routes are lazy-loaded
- [ ] Prop drilling does not exceed 2 levels
- [ ] URL state used for navigational state
- [ ] No useEffect where Context/Query/Router could work
- [ ] Dependencies array is complete and accurate
- [ ] No unnecessary memoization
- [ ] Styling uses Tailwind (or approved alternative)

