# Athly Project Comprehensive Documentation

This document provides an **extremely detailed** account of the Athly application: its architecture, coding conventions, MCP protocol usage, prompt engineering, and both client and server implementation specifics. It is intended for new team members, auditors, or anyone who wants to understand every aspect of the codebase and design decisions.

---

## Table of Contents
1. [Project Overview](#project-overview)
2. [Workspace Structure](#workspace-structure)
3. [Model Context Protocol (MCP)](#model-context-protocol-mcp)
   1. [Concepts & Flow](#concepts--flow)
   2. [Server Tools & Prompts](#server-tools--prompts)
   3. [Client Integration](#client-integration)
4. [Server Architecture](#server-architecture)
   1. [Setup & Initialization](#setup--initialization)
   2. [Database](#database)
   3. [Tool Modules](#tool-modules)
   4. [Prompt Registration](#prompt-registration)
   5. [System Instructions & Safety](#system-instructions--safety)
   6. [Security & Middleware](#security--middleware)
5. [Client Architecture](#client-architecture)
   1. [Initialization & Roots](#initialization--roots)
   2. [Global Request Handlers](#global-request-handlers)
   3. [Elicitation & Schema-Driven UI](#elicitation--schema-driven-ui)
   4. [System Prompt Enforcement](#system-prompt-enforcement)
   5. [Component Patterns](#component-patterns)
6. [Coding Standards & Guidelines](#coding-standards--guidelines)
   1. [General Rules](#general-rules)
   2. [Types & Validation](#types--validation)
   3. [Error Handling & Cancellation](#error-handling--cancellation)
   4. [Testing & Debugging](#testing--debugging)
7. [Security Considerations](#security-considerations)
8. [Deployment & Operations](#deployment--operations)
9. [Appendices](#appendices)
   1. [Code Samples](#code-samples)
   2. [Prompt Texts](#prompt-texts)
   3. [Frequently Asked Questions](#frequently-asked-questions)

---

## Project Overview

Athly is a trainer-coach platform designed to automate and personalize workout plans for users through an AI assistant. The system leverages a MERN stack plus the Model Context Protocol (MCP) to create a seamless integration between React frontend and a Node.js backend, with MongoDB as the persistent store.

The backend exposes tools to search exercises, create workouts, track progress, etc., and the frontend uses MCP to orchestrate LLM-driven conversations and elicitation flows. Security and safety are paramount: the system checks injury logs before recommending movements, ensures user consent for AI actions, and logs everything for review.

The key differentiator is the Heavy use of prompts (system, workflow) and a well-defined schema-based UI for elicitation, keeping the client logic-blind and allowing the server to steer behavior dynamically.


## Workspace Structure

```
athly.docs.txt
gym_exercise_dataset.csv
package.json
stretch_exercise_dataset.csv
client/
    eslint.config.js
    index.html
    package.json
    README.md
    tsconfig.app.json
    tsconfig.json
    tsconfig.node.json
    vite.config.ts
    public/
    src/
      App.css
      App.tsx
      index.css
      main.tsx
      assets/
      connection/
        api.ts
        config.ts
        mcpClient.ts
server/
    package.json
    tsconfig.json
    src/
      index.ts
      database/
        connection.ts
        exercises/
          searchExercises.ts
        models/
          ExerciseSchema.ts
          UserExerciseSchema.ts
          UserSchema.ts
          WorkoutSchema.ts
        seeds/
          exercises.ts
      domain/
        exercises/
          searchExercises.ts
          types.ts
        safety/
          guards.ts
        userExercise/
          userExerciseTypes.ts
        users/
          experienceProgression.ts
          types.ts
        workout/
          generationTargets.ts
          types.ts
      middleware/
        auth.ts
      prompts/
        eliteCoachSystem.prompt.ts
        registerSystemInstructions.ts
        userExerciseWeightPreference.prompt.ts
        workoutCreation.prompt.ts
        progressIntermediateAdvanced.prompt.ts
      resources/
      routes/
        auth.ts
      scripts/
        seed.ts
      tools/
        exercises/
          exercises.tool.ts
          index.ts
        progress/
          index.ts
          progressIntermediateAdvanced.tool.ts
          trackProgressIntermediateAdvanced.tool.ts
        userExercises/
          createUserExercises.tool.ts
          index.ts
          updateUserExercisePreferredWeight.tool.ts
        users/
          getUserProfile.tool.ts
          index.ts
        workouts/
          createWorkoutPlan.tool.ts
          index.ts
      utils/
        exerciseMapper.ts
```

Both client and server use TypeScript, and the server is designed in a modular fashion: each tool or prompt is encapsulated with its own registration function.


## Model Context Protocol (MCP)

### Concepts & Flow

MCP is a protocol for communication between an LLM host (client) and a tool-providing server. It abstracts away the raw HTTP calls and enforces a message format with roles (`system`, `user`, `assistant`) and support for elicitation requests (asking the user for missing parameters) and tool invocations.

The typical flow:
1. Client sends a sampling request via `sampling/createMessage` with conversation messages.
2. Server may interpose tools by returning a `tool` message; client executes the tool call and returns the result.
3. Elicitation: when a tool needs more parameters, it issues an `elicitation/create` request; the client shows a form to the user and sends the response back.

All sampling requests should include the system prompt as the first message, ensuring the LLM follows high-level rules.

### Server Tools & Prompts

- Tools are registered via `server.registerTool(...)` and describe their name, description, input schema, and handler. They often call database models or domain logic.
- Prompts are registered via `server.registerPrompt(...)` and represent conversation workflows. For example, the `workout-creation-plan` prompt orchestrates exercise search, progression logic, and workout creation in one turn using the AI.

Important prompts:
- **Elite Coach System Prompt** (`eliteCoachSystem.prompt.ts`): the main system instructions describing behaviour, format, safety, and data standards.
- **Workout Creation Plan**: step-by-step generation of a workout.
- **User Exercise Weight Preference**: simple prompt to update preferred weight.
- **Progress Intermediate Advanced Prompt**: interacts with progress tracking.

#### System Instructions Registration

A reusable helper `registerSystemInstructions` (see `prompts/registerSystemInstructions.ts`) standardises how servers publish their identity rules:
```ts
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
Clients can fetch this prompt and always prepend it before sampling calls.

### Client Integration

On the client side, the MCP client is initialised with capabilities (`sampling`, `roots`). Request handlers for elicitation and sampling are set globally. The client also contains utilities to fetch and enforce system instructions.

Key utilities:
- `fetchSystemInstructions(client)`
- `prependSystemInstructions(client, messages, systemInstructions?)`
- `initializeSystemInstructions(client)`

These ensure the system prompt is consistently applied.


## Server Architecture

### Setup & Initialization

`src/index.ts` is the entry point. It connects to MongoDB, registers tools and prompts, and starts the MCP transport (HTTP or stdio). CORS and authentication middleware are configured for security.

Important environment variables:
- `MONGODB_URI` – MongoDB connection
- `PORT`, `HOST` – server binding
- `MCP_TRANSPORT` – `http` or `stdio`
- `FRONTEND_ORIGIN` – for CORS

Prompts are registered early; the system instruction prompt is registered first to ensure precedence.

### Database

Mongoose models are defined for exercises, user exercises, users, and workouts. Seeds populate initial exercise data.

Example schema (`WorkoutSchema.ts`):
```ts
const WorkoutSchema = new mongoose.Schema({
  userId: String,
  exercises: Array,
  // ...
});
```

Connection logic lives in `database/connection.ts`.

### Tool Modules

Tools are grouped by feature. Each module has an index file that exports a registration function used during server startup.

Example: `tools/workouts/createWorkoutPlan.tool.ts` defines a tool with input validation (Zod schemas) and complex business logic including prioritization, time estimation, and safety filters.

### Prompt Registration

Prompts are defined under `src/prompts`. They export `registerXYZPrompt(server)` functions. Prompts use static strings with instructions or workflows, injected into MCP messages.

For example, `workoutCreation.prompt.ts` describes step-by-step logic for the AI agent to generate workouts based on user profile, apply progression logic, and call tools.

### System Instructions & Safety

The Elite Coach system prompt contains stringent safety rules:
- Prioritize injury log checks
- Ask user for pain/energy info
- Enforce concise responses and data standards
- Table formatting for workout routines

A metadata field `isSystem: true` ensures clients load it as a system message.

Safety protocols and check-in loops are detailed in the prompt text.

### Security & Middleware

The middleware folder currently contains `auth.ts` which enforces JWT-based authentication on MCP endpoints (unless `DANGEROUSLY_OMIT_AUTH` or dev mode is active).

CORS middleware restricts origins and methods.


## Client Architecture

### Initialization & Roots

The MCP client is configured in `client/src/connection/mcpClient.ts`. Capabilities include:
```ts
const client = new McpClient({ sampling: {}, roots: { '/user-data': ..., '/workouts': ... } });
```
File system roots are whitelisted strictly to avoid sensitive exposure.

### Global Request Handlers

The custom hook `useMCPProtocolHandlers` attaches handlers for elicitation and sampling that manage UI state for modals. The handlers ensure the UI is always aware of protocol events.

### Elicitation & Schema-Driven UI

The client dynamically renders forms based on `requestedSchema` objects provided by the server. The `DynamicFormBuilder` component and related helpers handle rendering, validation, and casting.

This pattern enables the server to change required fields without editing frontend code.

### System Prompt Enforcement

As outlined earlier, the utils in `systemPromptEnforcer.ts` fetch and cache the system instructions and prepend them to every sampling message list.

### Component Patterns

Components are small, stateless, and typed. Prop drilling is limited; contexts or URL state are used for deeper communication.

`App.tsx` is minimal, orchestrating global providers and routing. Lazy loading and code-splitting are applied to route components.


## Coding Standards & Guidelines

This project enforces strong architectural and style rules as detailed in `CLIENT_GUIDELINES.md`. Highlights:

- Always comment code and explain reasoning
- Keep business logic on server/tools, not in components or hooks
- Use TypeScript for type safety
- Validate form data and cast types before sending to tools
- Handle errors and cancellations gracefully
- Avoid prompt injection by wrapping server system prompts with local safety messages

General rules cover collaboration preferences, PR etiquette, and architecture norms.

### Types & Validation

Type files are organized under `src/types` on client and mirrored in server schemas where possible. Zod is used extensively on the server to validate tool inputs.

### Error Handling & Cancellation

Tools use a custom `OperationCancelledError` to bubble cancellations from elicitation flows. Every protocol-level `await` is wrapped in try/catch.

### Testing & Debugging

Though full automated tests aren't defined yet, the codebase supports multiple testing approaches and we encourage expanding coverage as features grow. Below are recommended methods and patterns for both manual and automated testing.

#### Manual Test Scripts & Helpers

- **Seed data**: run `node src/scripts/seed.ts` (server) to populate the database with sample exercises. Use this during local development to simulate realistic data.
- **Prompt verification**: manually fetch prompts via MCP client or hit `/mcp` with a simple sampling request to ensure prompts are registered correctly.
- **Client interaction**: perform UI flows in the browser, paying special attention to elicitation modals and system prompt enforcement (look at network logs to confirm the system message is prepended).

#### Automated Testing Suggestions

While no test suite currently exists, the architecture is ready for one. You can use any Node.js testing framework (Jest, Vitest, Mocha) for both server and client code. Example test ideas:

1. **Unit tests** for utility functions:
   - `systemPromptEnforcer.ts` – verify `prependSystemInstructions` behavior with mocked inputs.
   - Zod schema validation – supply valid/invalid payloads and assert correct errors.
   - Database helpers and mappers (e.g., `exerciseMapper.ts`).

2. **Integration tests**:
   - Start the MCP server in a test mode (using `tsx`) and send tool invocations to ensure they return expected results.
   - Use an in-memory MongoDB (e.g. `mongodb-memory-server`) to test database interactions without external dependencies.

3. **End-to-end (E2E) tests**:
   - Use a headless browser (Playwright, Cypress) to simulate user flows in the React client, verifying elicitation modals and tool calls.
   - Stub the MCP transport or use a local server instance with test prompts.

#### Running Tests Locally

- Add scripts to `package.json` in both `client` and `server`:
  ```json
  "scripts": {
    "test": "vitest --run",
    "test:server": "vitest --config vitest.server.config.ts",
    "test:client": "vitest --config vitest.client.config.ts"
  }
  ```
- For ad-hoc TS scripts, use `npx tsx path/to/script.ts`.

#### Example Unit Test (Vitest)

```ts
// server/tests/systemPromptEnforcer.spec.ts
import { prependSystemInstructions } from '../src/utils/systemPromptEnforcer';

describe('systemPromptEnforcer', () => {
  it('prepends system text to message list', async () => {
    const messages = [{ role: 'user', content: { type: 'text', text: 'hi' } }];
    const result = await prependSystemInstructions({} as any, messages, 'sys');
    expect(result[0].role).toBe('system');
    expect(result[0].content.text).toBe('sys');
  });
});
```

#### Test Data Management

- Use factories or fixtures to create predictable documents for database tests.
- Clear the test database between runs to ensure isolation.

With these methods in place, adding comprehensive test coverage becomes straightforward. Start with the core utilities and tools, then gradually expand to prompts and UI interactions.



## Security Considerations

- Authentication enforced on MCP endpoints
- CORS restricted
- Root directories locked down on client
- System prompt metadata flagged and automatically loaded to prevent user override
- Injury logs and user safety considered in prompts and tools

All data displayed to users avoids internal IDs and raw timestamps. Units are explicit.


## Deployment & Operations

Typical development flow:
```bash
cd server
npm install
npm run dev    # starts MCP server with tsx

cd client
npm install
npm run dev    # Vite dev server
```

Environment variables configure host, database, transport, and origins. Logging outputs errors to stderr.

For production, compile TypeScript or use tsx, and deploy with a process manager. Ensure MongoDB URI and CORS origins are set appropriately.


## Appendices

### Code Samples

(See earlier sections for large code excerpts.)

### Prompt Texts

The full Elite Coach prompt:
```
You are an **Elite Training Coach** specializing in **Hypertrophy (Muscle Growth)**.
Your mission is to bridge the gap between raw data and beginner‑friendly guidance.

---

1. **Safety first** – always check injury logs and user history before suggesting new movements.
2. **Polite helper** – ask for reassurance regularly and prompt the client to report any pain, soreness, fatigue, or lack of energy.
3. **Be concise** – never return long paragraphs; summarize information and highlight only the most important points.

# OPERATING GUIDELINES
...
```
(See file for full text.)

### Frequently Asked Questions

**Q:** *Will the system instructions always be enforced?*  
A: They will appear as the first system message if the client prepends them and the model respects system role messages. For stronger enforcement, server-side validation of outputs can be added.

**Q:** *How do I add a new tool?*  
A: Create a file under `src/tools`, define a zod input schema, make a handler, and export a `registerXYZTool` function. Import and register it in `src/index.ts` during startup.

**Q:** *Can I modify the Elite Coach prompt?*  
A: Yes—edit `eliteCoachSystem.prompt.ts`. The client will fetch the updated prompt automatically the next time it initialises system instructions.

**Q:** *What if the LLM ignores the system prompt?*  
A: Use a stricter model, add post‑response validation, or add additional system checks (e.g., forcing a second pass). Logging violations helps adjust the prompt.

**Q:** *How to handle user cancellations?*  
A: Tools catch `OperationCancelledError` and return a structured error; UI can display a friendly message.

---

This document is meant to evolve with the project; update it whenever new major features or architectural changes occur.


---

Feel free to reference individual source files and tests for deeper insight. The goal is to make onboarding and auditing painless.
