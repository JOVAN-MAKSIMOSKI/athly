# API Reference

This document covers the main REST endpoints exposed by the Athly backend and notes how MCP fits into the platform.

Base server URL by default:

```text
http://127.0.0.1:3000
```

## Authentication

Athly uses cookie-based JWT auth with:

- `sign_token` access cookie
- `refresh_token` refresh cookie

## REST Endpoints

### POST `/auth/signup`

Creates a new user, issues auth cookies, and returns the created user.

Example request:

```json
{
  "email": "user@example.com",
  "name": "Jovan",
  "password": "secret123",
  "profile": {
    "weight": 80,
    "height": 180,
    "comfortableWithHeavierWeights": true,
    "workoutDurationMinutes": 60,
    "workoutFrequencyPerWeek": 4,
    "availableEquipment": ["dumbbells", "bench"]
  }
}
```

Notes:

- validates input with Zod
- normalizes equipment aliases before persistence
- sets both access and refresh cookies on success

### POST `/auth/login`

Authenticates a user with email and password and reissues auth cookies.

Example request:

```json
{
  "email": "user@example.com",
  "password": "secret123"
}
```

### POST `/auth/refresh`

Rotates session state from the refresh cookie and returns a fresh access token payload.

Notes:

- requires the refresh cookie to be present
- clears cookies if the refresh token is invalid or revoked

### POST `/auth/logout`

Clears auth cookies and revokes the stored refresh token hash when possible.

### PATCH `/auth/profile`

Updates authenticated user profile fields currently exposed by this route.

Current supported payload:

```json
{
  "WorkoutSplit": "push_pull_legs"
}
```

This route requires authentication.

### POST `/llm/message`

Runs the LLM router against Vertex AI and supports tool declarations derived from the MCP registry.

Example request shape:

```json
{
  "messages": [
    {
      "role": "system",
      "content": { "type": "text", "text": "You are Athly." }
    },
    {
      "role": "user",
      "content": { "type": "text", "text": "Build me a chest workout." }
    }
  ],
  "registry": {
    "tools": [
      {
        "name": "createWorkoutPlan",
        "description": "Create a workout plan"
      }
    ]
  },
  "maxTokens": 2048,
  "toolMode": "auto"
}
```

Notes:

- validates payloads with Zod
- injects authenticated `userId` into hidden model context when available
- chooses a light, standard, or complex Vertex model based on request complexity

### GET `/workouts`

Returns workouts for the authenticated user, newest first.

The response includes:

- workout metadata
- normalized exercise rows
- populated exercise name, equipment, and form tips
- populated current target weight where available

### POST `/workouts/replace-exercise`

Finds a replacement exercise for a workout entry.

Example request:

```json
{
  "workoutId": "661111111111111111111111",
  "userExerciseId": "662222222222222222222222",
  "query": "Find a safer chest replacement with dumbbells",
  "limit": 5,
  "filters": {
    "targetMuscle": "chest",
    "equipment": "dumbbell"
  }
}
```

Notes:

- embeds the query for vector search
- searches Qdrant first
- falls back to MongoDB ranking if vector search fails

## MCP Endpoint

The MCP server is mounted at:

```text
/mcp
```

Supported methods at the HTTP layer include:

- `POST /mcp` for initialize and message handling
- `GET /mcp` for session-bound transport handling
- `DELETE /mcp` for session cleanup

The MCP server registers tools for:

- exercises
- users
- user exercise preferences
- workout creation and generation
- workout split planning
- progress tracking

It also registers prompts for:

- elite coach system instructions
- workout creation
- progress intermediate/advanced flow
- user exercise weight preference

## Error Style

The backend usually returns JSON objects shaped like:

```json
{
  "code": "INVALID_INPUT",
  "message": "Human readable description"
}
```

Validation failures often include Zod `details` payloads.