# Athly Application Setup Instructions

## Documentation
- **Backend/MCP Rules:** See this file
- **Frontend/React Rules:** See [CLIENT_GUIDELINES.md](CLIENT_GUIDELINES.md)

## Overview
This is a monorepo containing a client and server application using MCP (Model Context Protocol) v1.26+ architecture.

## MCP Transport Standard (Project-Wide)
- **Required transport:** MCP Streamable HTTP transport (`MCP_TRANSPORT=http`).
- **Server:** Uses `StreamableHTTPServerTransport`.
- **Client:** Uses `StreamableHTTPClientTransport`.
- **Note:** SSE is the event-stream mechanism used under Streamable HTTP.
- **Do not use stdio transport** for regular client/server app runtime in this repo.

## Project Structure
```
athly/
├── client/          # Frontend application
├── server/          # Backend MCP server
├── package.json     # Root workspace configuration
└── .env            # Environment variables
```

## Prerequisites
- Node.js (v18+)
- npm (v9+)
- MongoDB connection
- MCP v1.26+ compatibility

## Installation

1. Install dependencies for all workspaces:
   ```bash
   npm install
   ```

2. Set up environment variables in the root `.env` file:
   ```
   MONGODB_URI=mongodb+srv://[user]:[password]@[cluster].mongodb.net/
   PORT=3000
   DB_NAME=mcptestdb
  MCP_TRANSPORT=http
   ```

## Quick Fix Tip (TypeScript Module Resolution)

If you see errors like `Cannot find module './views/NotFoundPage.tsx'` in the client:

- Prefer extensionless imports in React/TS files:
  - Use `import('./views/NotFoundPage')` instead of `import('./views/NotFoundPage.tsx')`
  - Use `import { AppLayout } from './views/AppLayout'` instead of `./views/AppLayout.tsx`
- Verify the file exists in the exact folder used by the import path.
- Re-run client checks:
  - `npm run build --workspace=client`
  - or from `client/`: `npm run build`

## Running the Application

### Development Mode
```bash
# Run server in development mode with watch
npm run dev --workspace=server

# Run client in development mode
npm run dev --workspace=client
```

### Production Mode
```bash
# Build server
npm run build --workspace=server

# Start server
npm run start --workspace=server
```

## Available Scripts

### Server Scripts
- `npm run dev` - Start server with file watching
- `npm run start` - Start server (production)
- `npm run test` - Run tests

### Client Scripts
- See client/package.json for client-specific scripts

---

# Project Overview & Features

## General Description
**[Add your general project description here]**
- What is Athly? - Athly is an AI Agent designed to help individuals with their fitness journey
- Who is it for? - Anyone seeking guidance troughout their fitness journey
- What problem does it solve? - Individuals not having enough experience and knowledge but want to get into fitness and they save money by not paying a personal trainer 

## Core Features
**[Add your core features here]**
- The Architect (Core): [User Profile management, Safety Guardrails, and the Workout Generation Logic.]
- The Exercise Library: [A searchable, descriptive database of movements with safety contraindications.]
- The Tracker (Logging): [Session logging, adherence tracking, and performance analytics.]
- The Auto-Coach: [The Auto-progression engine and the Chat/Agent interface.]

## User Intents (What users want to do)
**[Add primary user intents here]**
- Intent 1: [What users want]
- Intent 2: [What users want]

---

# 8-Week Development Timeline

## Week 1 — The Architect (Core Systems)
- **Status:** INITIALIZING.
- **Goal:** Build the deterministic foundation. No AI chat yet.
- **Immediate Tasks:**
  1. Define `src/domain/users/types.ts` (Zod schemas for Profile & Safety).
  2. Implement `src/database/models/User.ts` (Mongoose strict mode).
  3. Create `src/domain/safety/rules.ts` (Hard-coded medical constraints).
  4. **LlamaIndex Prep:** Ensure every schema field has a `.describe()` key for future vector indexing.

---

# Architecture & Development Rules
-When you ask for my permission, please explain why you need it!

## Collaboration Preferences (Jovan)

- When a prompt ends with a question mark, answer only and do not perform actions.
- Before a larger single code update, provide a brief implementation plan first.
- Do not start code changes with missing context.
- When making code changes, include comments describing the changes.
- Before proceeding with the next user message, stop and clean up any running terminals started by the assistant during the previous turn.

### MCP Server Preferences

- Use MCP context/log messaging to communicate progress back to the client during ongoing tasks.
- During MCP tool debugging, use `console.error` instead of `console.log`.
- Use the server instance to send logs directly to the tool user (Inspector).
- Stop running background terminals; focus active execution.
- Do not use `JSON.parse(JSON.stringify())` for deep copy; use `structuredClone()`.
- When updating a database schema or a Zod schema, update all linked/related locations across the codebase.

## Elicitation Architecture (Stateful Tool Execution)

### Overview

Treat MCP tools as **long-running processes that can "pause."** If a tool requires a parameter not provided in the initial call, do not fail the tool. Instead, invoke `ctx.elicitation.create()` to retrieve the missing data from the client.

### Stateful Tool Execution Pattern

```typescript
// tools/workout/generateWorkoutPlan.tool.ts
async function handleGenerateWorkout(params: GenerateWorkoutParams, ctx: McpContext) {
  try {
    // Step 1: Check if all required data is available
    if (!params.experienceLevel) {
      // Step 2: Request missing data from client
      const response = await ctx.elicitation.create({
        message: "To create your personalized plan, we need to know your fitness experience.",
        requestedSchema: experienceLevelSchema,
      });
      
      // Step 3: Handle user response
      if (response.action === 'cancel') {
        return errorResponse('User cancelled elicitation');
      }
      
      params.experienceLevel = response.data.experienceLevel;
    }
    
    // Step 4: Continue with normal tool logic
    const workoutPlan = generatePlanLogic(params);
    return successResponse(workoutPlan);
  } catch (error) {
    // Step 5: Handle errors gracefully
    return handleToolError(error);
  }
}
```

### Key Rules

1. **Never Fail on Missing Parameters**
   - If a parameter is optional for the tool but needed for good results, use elicitation
   - Don't hardcode defaults that bypass user intent

2. **Separation of Concerns**
   - **Server:** Defines what data is needed (via schemas)
   - **Client:** Defines how to collect it (UI/UX) and validates types
   - Neither should assume the other's implementation

3. **Success Path Only**
   - Tools should only call elicitation for clarification
   - Tools should not attempt to "populate" elicitation with suggestions
   - Let the user provide primary data

---

### The Bouncer Principle & Guard Helpers

**Core Concept:** Never implement `ctx.elicitation.create()` or `ctx.sampling.createMessage()` directly inside a tool's primary business logic. Instead, use **Guard helpers** that encapsulate all protocol-level interactions.

**Benefits:**
- Tools stay focused on _what to do_, not _how to communicate_
- Protocol logic is centralized and reusable
- Testability improves (helpers can be mocked/tested independently)
- Easier to swap implementations (e.g., changing from elicitation to defaults)

### Centralized MCP Helpers

**File:** `src/utils/mcpHelpers.ts`

This file contains all shared logic for interacting with the MCP protocol. Two primary helpers exist:

#### 1. ensureParams - Elicitation Guard

```typescript
// src/utils/mcpHelpers.ts
export interface RequirementSchema {
  [key: string]: {
    type: 'string' | 'number' | 'boolean' | 'enum';
    enum?: string[];
    required: boolean;
    message?: string;
  };
}

export async function ensureParams(
  ctx: McpContext,
  args: Record<string, any>,
  requirements: RequirementSchema
): Promise<Record<string, any>> {
  const cleanData = { ...args };

  for (const [key, requirement] of Object.entries(requirements)) {
    // Step 1: Check if parameter exists
    if (cleanData[key] === undefined && requirement.required) {
      try {
        // Step 2: Request elicitation from client
        const schema = buildSchemaFromRequirement(key, requirement);
        const response = await ctx.elicitation.create({
          message: requirement.message || `Please provide ${key}`,
          requestedSchema: schema,
        });

        // Step 3: Handle cancellation
        if (response.action === 'cancel' || response.action === 'decline') {
          throw new OperationCancelledError(`User declined to provide ${key}`);
        }

        // Step 4: Type-cast the response
        cleanData[key] = castValue(response.data[key], requirement.type);
      } catch (error) {
        if (error instanceof OperationCancelledError) {
          throw error; // Let tool handle cancellation
        }
        throw new Error(`Failed to elicit ${key}: ${error.message}`);
      }
    }
  }

  return cleanData;
}

// Helper to cast types safely
function castValue(value: any, type: string): any {
  if (type === 'number') return Number(value);
  if (type === 'boolean') return value === 'true' || value === true;
  return value; // Keep as string
}
```

**Tool Usage:**
```typescript
// tools/workout/generateWorkoutPlan.tool.ts
async function handleGenerateWorkout(args: GenerateWorkoutParams, ctx: McpContext) {
  try {
    // Step 1: Guard - ensure all required params are available
    const cleanData = await ensureParams(ctx, args, {
      experienceLevel: {
        type: 'enum',
        enum: ['beginner', 'intermediate', 'advanced'],
        required: true,
        message: 'To create your personalized plan, what is your fitness experience level?',
      },
      fitnessGoal: {
        type: 'string',
        required: false, // Optional, tool can proceed without it
      },
    });

    // Step 2: Continue with business logic
    const workoutPlan = generatePlanLogic(cleanData);
    return successResponse(workoutPlan);
  } catch (error) {
    if (error instanceof OperationCancelledError) {
      return { error: error.message, isError: true };
    }
    return handleToolError(error);
  }
}
```

---

### Sampling (Reasoning Guarding)

**Use Case:** When a tool needs to make a decision based on raw data, use the **Analyst helper** to request AI reasoning from the client.

**Examples:**
- "Should I adjust this training volume based on adherence stats?"
- "Is this user's recovery status concerning?"
- "Which exercise variation is best for this user's goal?"

#### 2. requestAnalysis - Sampling Guard

```typescript
// src/utils/mcpHelpers.ts
export interface AnalysisRequest {
  prompt: string; // The reasoning prompt
  data: Record<string, any>; // Data to be analyzed
  expectedFormat?: string; // Optional guidance on response ('`json`, `text`, `decision`)
}

export async function requestAnalysis(
  ctx: McpContext,
  request: AnalysisRequest
): Promise<string> {
  try {
    const response = await ctx.sampling.createMessage({
      messages: [
        {
          role: 'user',
          content: `${request.prompt}\n\nData to analyze:\n${JSON.stringify(request.data, null, 2)}`,
        },
      ],
      systemPrompt: `You are a fitness analysis assistant. Provide clear, actionable insights.${request.expectedFormat ? ` Format your response as ${request.expectedFormat}.` : ''}`,
      modelPreferences: {},
    });

    // Extract the assistant's message
    if (response.content?.[0]?.type === 'text') {
      return response.content[0].text;
    }
    throw new Error('No text response from LLM');
  } catch (error) {
    throw new Error(`Analysis request failed: ${error.message}`);
  }
}
```

**Tool Usage:**
```typescript
// tools/progress/trackProgress.tool.ts
async function handleTrackProgress(args: TrackProgressParams, ctx: McpContext) {
  try {
    // Step 1: Gather raw progress data
    const progressData = await loadProgressStats(args.userId);

    // Step 2: Request AI analysis
    const analysis = await requestAnalysis(ctx, {
      prompt: `Analyze this user's training progress over the last 4 weeks. 
               Should we adjust volume or intensity? Consider fatigue, form consistency, and goals.`,
      data: progressData,
      expectedFormat: 'json with keys: recommendation, reasoning, urgency_level',
    });

    // Step 3: Continue with tool logic using the analysis
    const recommendation = parseAnalysisResponse(analysis);
    const updatedPlan = applyRecommendationToPlan(progressData, recommendation);

    return successResponse(updatedPlan);
  } catch (error) {
    return handleToolError(error);
  }
}
```

---

## Core Principles

1. **Follow this ruleset as default architecture** - If a better solution exists outside this scope, explicitly suggest it with reasoning before proceeding
2. **Always explain your decisions** - Brief explanation of why things are done a certain way
3. **MCP v1.26+ compliance** - All code must be compatible with MCP SDK v1.26+
4. **Logic Isolation Rule** - NEVER write business logic inside a `tool.ts` file
   - **WRONG:** A tool that calculates BMI inside the `handler`
   - **RIGHT:** A tool that imports `calculateBMI` from `src/domain/biometrics.ts`
   - **Why?** This ensures we can test the math without spinning up an MCP server

## MCP Server Architecture

### Project Layout
```
server/
├─ src/
│  ├─ server.ts                # MCP server bootstrap
│  ├─ tools/                   # Executable capabilities (grouped by feature)
│  │  ├─ [feature]/
│  │  │  ├─ [feature].tool.ts
│  │  │  └─ index.ts
│  ├─ prompts/                 # Reasoning + explanation
│  │  ├─ [feature]/
│  │  │  └─ [feature].prompt.ts
│  │  └─ common/
│  │     ├─ detectIntent.prompt.ts
│  │     └─ fallback.prompt.ts
│  ├─ resources/               # Static knowledge (GLOBAL)
│  │  ├─ schema/
│  │  ├─ rules/
│  │  └─ enums/
│  ├─ domain/                  # Pure business logic
│  │  ├─ [feature]/
│  │  │  ├─ validate[Feature].ts
│  │  │  ├─ normalize[Feature].ts
│  │  │  ├─ compute[Feature].ts
│  │  │  └─ index.ts
│  ├─ database/                # DB layer
│  │  ├─ connection.ts
│  │  ├─ [models]/
│  │  │  ├─ ..schema.ts
│  │  │  ├─ ..schema.ts
│  │  │  └─ ..schema.ts
│  │  └─ index.ts
│  ├─ utils/                   # Shared helpers
│  │  ├─ errors.ts
│  │  ├─ guards.ts
│  │  ├─ formatters.ts
│  │  ├─ dataLoaders.ts
│  │  ├─ dataSplitters.ts
│  │  ├─ uriGenerators.ts
│  │  └─ metadataGenerators.ts
│  └─ index.ts
├─ .env
└─ package.json
```

### Tool Design Rules

**Verbs start tool names. Prompts summarize behavior. Resources reflect data domain.**

Tools MUST:
- Live at `server/src/tools/[feature]/[feature].tool.ts`
- Use a named export (e.g., `register[Feature]Tool`)
- Return structured data only
- Contain clear `.describe()` on EVERYTHING
- Contain clear descriptions explaining when they should be used
- Use the namespaced tool name format: `athly.<verb>_<domain_or_action>`
- Use snake_case after the namespace and keep names verb-first
- Keep names concise and domain-specific (examples: `athly.get_user_profile`, `athly.search_exercises`, `athly.create_workout_plan`)
- Include strict output-format instructions directly inside the tool metadata `description`.
- Use the response-format phrase prefix `RESPONSE FORMAT:` in every tool `description`.
- NOT return analysis text or long explanations
- NOT overlap with prompt responsibilities
- Answer: "What happened? Why? Can the prompt reason on it?"

**Naming Convention Notes:**
- Existing non-namespaced tool names are allowed only for backward compatibility during migration.
- All newly created tools MUST use the `athly.` namespace.
- If an existing tool is renamed, update all prompt/tool callers in the same change.

**Required metadata style for all new tools:**

```typescript
const exampleToolDefinition = {
  name: 'athly.create_workout_plan',
  description:
    'Creates a workout plan and saves it in the database. RESPONSE FORMAT: Return only the workout ID and a confirmation message. Do not format with markdown, emojis, or explanations.',
  inputSchema: CreateWorkoutPlanInputSchema,
  restricted: false,
};
```

Notes:
- In this repo, MCP tool definitions use `inputSchema` (not `parameters`).
- Keep the response-format contract concise, explicit, and testable.

**Tool Categories:**
- **Data Access Layer**: Load data from DB
- **Computation Layer**: Transform data into metrics
- **Analysis Layer**: Provide insights (if not done by prompts)

**LLM-Facing vs Internal Tools:**
- LLM-facing tools: Set `restricted: false`, should NOT throw (return error objects)
- Internal/restricted tools: Set `restricted: true`, should throw to preserve atomicity

**Tool Response Pattern:**
Return JSON-stringified data inside the MCP content text (no chatty analysis text):
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"success\":true,\"data\":{...}}"
    }
  ]
}
```

**Tool Error Handling & Resilience:**

- **Never throw unhandled exceptions** from LLM-facing tools
- **For errors, return structured error response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Error details..."
    }
  ],
  "isError": true
}
```

- **Wrap elicitation calls in try/catch:**

```typescript
async function toolHandler(params, ctx: McpContext) {
  try {
    const elicitationResponse = await ctx.elicitation.create({
      message: "...",
      requestedSchema: schema,
    });
    
    // Process response
    if (elicitationResponse.action === 'decline') {
      return errorResponse('User declined to provide data');
    }
    
    // Continue
  } catch (elicitationError) {
    // Handle timeout, network failure, or other errors
    return errorResponse(`Elicitation failed: ${elicitationError.message}`);
  }
}
```

- **Never fail the entire MCP server process** due to user rejection or timeout
- Gracefully degrade to fallback behavior or inform the user

**Tool Chaining:**
- Tools MAY chain internally when needed (validation, normalization, atomic workflows)
- Multi-step computation must be broken into multiple tools
- Tools should NOT be created if a prompt already covers that role

**Tool Wiring:**
- The `restricted` flag is custom middleware metadata
- MUST strip `restricted` before passing the definition to `server.tool()`

### Prompt Design Rules

Prompts MUST:
- Declare required arguments via Zod BEFORE writing handler and always use describe with the zod schema on everything you declare, feel free to use a little detailed describe text at least 8 words.
- NOT fetch data (only use tool outputs)
- NOT compute values
- Clearly describe which tools they depend on
- Include `.describe()` on all inputs

**Naming Patterns:**
- `summarize-something` → short human summary
- `describe-something` → long detailed description
- `overview-something` → bullet-point recap

**Add conditional logic inside prompts when:**
1. Arguments are optional
2. User intent changes output
3. Different arguments imply different reasoning paths
4. User-provided arguments combined with tool-provided data

**Prompt Error Handling:**
- Handle missing/invalid arguments gracefully
- Provide fallback responses
- Example: "Unable to analyze performance: no data available for this period"

### Resource Design Rules

**Only design these resource types** (ask for permission for anything else):
1. **Schema resources** - collections, fields, types, relationships
2. **Rules/constraints resources** - business constraints, limits
3. **Enums** - allowed values for specific fields

**Resources MUST NEVER contain:**
- Computed or dynamic values
- Runtime calculations
- Unstable values
- Things that change often
- The SAME keys as tools return

**Use resources for:**
- Static data, reference data, large text
- Config, schema definitions, default values
- Environment metadata

**Use tools instead for:**
- Dynamic DB data, runtime calculations
- Unstable values, things that change often

### Shared Helper Functions

All helpers go in `src/utils/`. MUST include:

**dataLoaders.ts**
```typescript
loadCollection(name: string): Promise<T[]>
loadFile(path: string): Promise<string>
```

**dataSplitters.ts**
```typescript
splitBySize(data: T[], chunkSize: number): T[][]
splitByCategory(data: T[], key: string): Map<string, T[]>
```

**formatters.ts**
```typescript
formatResourceContent(data: T): string
formatToolResponse(data: T): ToolResponse
```

**uriGenerators.ts**
```typescript
generateResourceURI(type: string, id: string): string
```

**metadataGenerators.ts**
```typescript
generateResourceMetadata(resource: T): Metadata
```

### Context Preservation & Elicitation Messages

### Message Best Practices

When calling `ctx.elicitation.create()`, the `message` field is critical for helping users provide accurate information.

**Requirements:**
1. **Explain why** the data is needed
2. **Explain what it's used for** (impact on their experience)
3. **Keep it concise** but not vague

**Examples:**

✅ **Good:**
```typescript
const message = "To recommend safe exercises, we need to know if you have any joint pain or injuries. This helps us avoid movements that could hurt you.";
```

❌ **Bad:**
```typescript
const message = "Do you have any pain?";
```

---

# Agent Instruction: Decision-Making Principle

- Never use the word "likely" or make decisions based on assumptions or probabilities.
- If you need certain information to proceed, always ask the user directly instead of guessing or inferring.

---

## Session Management & Timeouts

### Timeout Strategy

Implement timeouts for elicitation requests to prevent blocking server resources.

**Guidelines:**
- Default timeout: **60-120 seconds**
- Timeout should be configurable per elicitation request
- On timeout: Resolve with a default value OR return a "Timeout" error

**Implementation:**
```typescript
async function toolWithTimeout(params, ctx: McpContext) {
  const elicitationPromise = ctx.elicitation.create({
    message: "Please provide your experience level...",
    requestedSchema: schema,
  });
  
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Elicitation timeout')), 90000); // 90 seconds
  });
  
  try {
    const response = await Promise.race([elicitationPromise, timeoutPromise]);
    return processResponse(response);
  } catch (error) {
    if (error.message === 'Elicitation timeout') {
      // Resolve with default or error
      return errorResponse('User did not respond in time. Using default settings.');
    }
    throw error;
  }
}
```

**Benefits:**
- Frees up server resources after long waits
- Prevents indefinite blocking
- Improves user experience (clear timeout feedback)

---

## Error Handling

**Tools:**
- LLM-facing tools: Never throw, return error objects
- Internal/restricted tools: Throw to preserve atomicity
- Use pagination for large datasets
- Include error codes for categorization

**Validation:**
- Use Zod for ALL input validation
- Validate at tool boundaries
- Never pass invalid data to prompts

**Database Queries:**
- Empty result ≠ error (means no data)
- Only errors point to system failures
- Tools must NOT be called twice accidentally
- Tools must be deterministic by design

## Database Architecture

- **One shared DB instance** at server startup (see `src/database/connection.ts`)
- **All database logic** stays in `src/database/` folder
- **Store everything in UTC**

**Read Tools MUST:**
- Return the same structure every time
- Not mutate state
- Not depend on hidden runtime context
- Answer exactly one question
- Include pagination for large results

**Write Tools MUST follow this shape:**
1. Check current state
2. Decide if write is allowed
3. Perform write OR skip
4. Return explicit outcome

**Aggregation:**
- AGGREGATION IS NOT OPTIONAL (LLM can't math reliably)
- Must ALWAYS be snapshot-based
- Never change output format based on data

## Planning Process

### Step 1: Understand User Intent
- What will the agent do?
- What user intents will it support?
- Which features require data?
- Which features require analysis?
- Which features require explanation?

### Step 2: Create a Capability Map
For each feature:
- Feature Name
- User Intents (what users may type)
- Required Data (facts needed to answer)
- Raw Data Tools (fetch data)
- Logic Tools (computed values)
- Final Prompts
- Resources Needed
- Arguments Required by Prompts
- Pre-validation tools required?
- Fail-Open or Fail-Closed?

### Step 3: Agent Patterns

**Small Agent:** Direct tool → prompt

**Big Agent:** Follow this 5-step pattern:
1. **INTENT DETECTION** (prompt) - "What does the user want?"
2. **DATA GATHERING** (tools) - "What data do I need?"
3. **COMPUTATION** (tools) - "Turn data into metrics."
4. **CONTEXTUAL ANALYSIS** (prompt) - "What does this mean?"
5. **HUMAN OUTPUT** (prompt) - "Write it clearly."

### Step 4: Design Tools & Prompts

**Verify:**
- Each prompt argument can be satisfied by a tool
- If an argument has no corresponding tool output → warn BEFORE coding
- No tool duplicates logic from another tool
- All shared logic is in `src/utils/`
- Tools and prompts have non-overlapping responsibilities

## Client Architecture

```
client/web/
  src/
    components/
    hooks/
    pages/
    services/
      mcpClient.ts
    types/
```

**State Boundary:** Only these cross from MCP to UI:
- User messages and action intents
- Current view identifiers
- Selected IDs
- Lightweight UI hints
- Optional conversation reference

**UI Rule:** The UI must NEVER contain business truth

## Best Practices: Data Management

### Small, Stable Dataset (1–10 documents)
- One resource for entire dataset

### Medium Dataset (50–500 documents) 
- One "index directory" resource per domain

### Tool-Then-Prompt Pattern
- Use when output depends on tool data
- Tool fetches/computes → Prompt analyzes/explains

### Timestamps
- Use ISO-8601 strings in APIs
- Use "asOf" timestamps in analytics tools

---

## Troubleshooting

### Database Connection Issues
- Verify `MONGODB_URI` is correctly set in `.env`
- Check MongoDB cluster is accessible
- Ensure network IP is whitelisted in MongoDB Atlas

### Port Already in Use
- Change `PORT` in `.env` if port 3000 is unavailable
- Or kill the process: `lsof -ti:3000 | xargs kill -9` (macOS/Linux)

### Module Not Found Errors
- Run `npm install` to ensure all dependencies are installed
- Clear node_modules and reinstall: `rm -rf node_modules package-lock.json && npm install`

### MCP Compatibility Issues
- Verify MCP v1.4+ is installed
- Check all tools have `.describe()` 
- Verify argument schemas use Zod before handlers



