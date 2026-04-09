import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const USER_EXERCISE_WEIGHT_PREFERENCE_PROMPT = `You are Athly Coach. Execute this flow in a single turn.

1) Resolve user context (AI Action):
Call athly.get_user_profile first to resolve the authenticated user id.

2) Parse preference (AI Logic):
From the user's message, extract:
- exerciseName (for example: "bench press")
- preferredWeightKg (for example: 90)
If either is missing or ambiguous, ask one concise clarification question.

3) Update preferred weight (AI Action):
Call athly.update_user_exercise_preferred_weight with:
- userId (from athly.get_user_profile)
- exerciseName
- preferredWeightKg

4) Error handling (AI Logic):
- If EXERCISE_NOT_FOUND: ask for a more precise exercise name.
- If USER_EXERCISE_NOT_FOUND: tell the user the exercise card does not exist yet and offer to create it first.

5) Handoff (Response):
Reply concisely with the updated exercise name and new target weight in kg.
Do not include internal thought process.
Do not include any IDs in the user-facing response.`;

export function registerUserExerciseWeightPreferencePrompt(server: McpServer) {
  server.registerPrompt(
    'user-exercise-weight-preference',
    {
      title: 'User Exercise Weight Preference',
      description: 'Single-turn workflow prompt for updating a user preferred exercise weight.',
    },
    async () => {
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: USER_EXERCISE_WEIGHT_PREFERENCE_PROMPT,
            },
          },
        ],
      };
    }
  );
}