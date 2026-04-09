import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const WORKOUT_CREATION_PROMPT = `You are Athly Coach. Execute workout generation in a single authoritative server call.

1) Tool call:
Call athly.generate_workout with:
- userId
- request: the user's workout request verbatim

2) Tool discipline:
For workout generation, do NOT call athly.get_user_profile, athly.search_exercises, athly.create_user_exercises, or athly.create_workout_plan separately.
athly.generate_workout already performs profile lookup, exercise selection, target generation, user-exercise updates, and workout persistence on the server.

3) Response:
After a successful tool result, summarize the saved workout using the returned data:
- workout name
- focus / training type
- key exercises with sets, reps, rpe, or 2x to failure, rest, and weight
- respected constraints
- any applied flex rules

4) Guardrails:
- Never expose internal IDs.
- Never claim the workout is saved unless athly.generate_workout succeeds.
- Do not invent exercises, sets, reps, rest, or weights outside the tool response.`;

export function registerWorkoutCreationPrompt(server: McpServer) {
  server.registerPrompt(
    'workout-creation-plan',
    {
      title: 'Workout Creation Plan',
      description: 'Single-turn workflow prompt for generating and saving a workout plan.',
    },
    async () => {
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: WORKOUT_CREATION_PROMPT,
            },
          },
        ],
      };
    }
  );
}
