import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { EquipmentEnum } from '../../domain/exercises/types.js';
import { buildSearchExercisesCriteria } from '../../domain/exercises/searchExercises.js';
import { searchExercisesInDb } from '../../database/exercises/searchExercises.js';
import { ExerciseModel } from '../../database/models/ExerciseSchema.js';

type ToolTextContent = { type: 'text'; text: string };

type ToolResponse = {
  content: ToolTextContent[];
  isError?: true;
};

const SearchExercisesInputSchema = z
  .object({
    target: z
      .string()
      .min(1)
      .nullish()
      .transform((value) => value ?? undefined)
      .describe('Target muscle name or alias used to filter exercises.'),
    query: z
      .string()
      .min(1)
      .nullish()
      .transform((value) => value ?? undefined)
      .describe('Free text query to match exercise names when provided.'),
    equipment: z
      .array(EquipmentEnum)
      .nullish()
      .transform((value) => value ?? undefined)
      .describe('Filter results to exercises that use specific equipment.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(25)
      .describe('Maximum number of exercises to return per request.'),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe('Number of exercises to skip for pagination control.'),
  })
  .describe('Search inputs for the exercise library query tool.');

const searchExercisesToolDefinition = {
  name: 'athly.search_exercises',
  description: 'Searches the exercise library using target muscles or text. RESPONSE FORMAT: Return JSON only in content[0].text with {"success":true,"data":{...}} on success, or {"code":"...","message":"..."} with isError=true on failure. Do not include markdown, emojis, or narrative text.',
  inputSchema: SearchExercisesInputSchema,
  restricted: false,
};

const SearchExerciseByIdInputSchema = z
  .object({
    exerciseId: z
      .string()
      .trim()
      .min(1)
      .regex(/^[a-fA-F0-9]{24}$/, 'exerciseId must be a valid Mongo ObjectId')
      .describe('Exercise id to fetch from the exercise library.'),
  })
  .describe('Input for retrieving a single exercise by id.');

const searchExerciseByIdToolDefinition = {
  name: 'athly.search_exercise_by_id',
  description:
    'Fetches one exercise by its id from the exercise library. RESPONSE FORMAT: Return JSON only in content[0].text with {"success":true,"data":{...}} on success, or {"code":"...","message":"..."} with isError=true on failure. Do not include markdown, emojis, or narrative text.',
  inputSchema: SearchExerciseByIdInputSchema,
  restricted: false,
};

export function registerExercisesTool(server: McpServer) {
  const logToInspector = async (level: 'debug' | 'info' | 'warning' | 'error', data: unknown) => {
    try {
      await server.sendLoggingMessage({
        level,
        logger: searchExercisesToolDefinition.name,
        data,
      });
    } catch {
      // Best-effort logging only.
    }
  };

  server.registerTool(
    searchExercisesToolDefinition.name,
    {
      description: searchExercisesToolDefinition.description,
      inputSchema: searchExercisesToolDefinition.inputSchema,
    },
    async (args) => {
      try {
        const parsed = SearchExercisesInputSchema.parse(args);
        await logToInspector('debug', { event: 'input', payload: parsed });

        const criteria = buildSearchExercisesCriteria(parsed);
        await logToInspector('debug', { event: 'criteria', payload: criteria });

        const result = await searchExercisesInDb(criteria);
        await logToInspector('info', {
          event: 'result',
          count: result?.items?.length ?? 0,
          total: result?.total ?? 0,
        });

        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, data: result }) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        await logToInspector('error', { event: 'error', message });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ code: 'SEARCH_EXERCISES_FAILED', message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    searchExerciseByIdToolDefinition.name,
    {
      description: searchExerciseByIdToolDefinition.description,
      inputSchema: searchExerciseByIdToolDefinition.inputSchema,
    },
    async (args): Promise<ToolResponse> => {
      try {
        const parsed = SearchExerciseByIdInputSchema.parse(args);
        await logToInspector('debug', {
          event: 'input',
          tool: searchExerciseByIdToolDefinition.name,
          payload: parsed,
        });

        const exercise = await ExerciseModel.findById(parsed.exerciseId).lean();
        if (!exercise) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  code: 'EXERCISE_NOT_FOUND',
                  message: 'Exercise not found for the provided id',
                }),
              },
            ],
            isError: true,
          };
        }

        const result = {
          id: String(exercise._id ?? ''),
          name: String(exercise.name ?? ''),
          targetMuscle: exercise.targetMuscle,
          secondaryMuscles: Array.isArray(exercise.secondaryMuscles) ? exercise.secondaryMuscles : [],
          equipment: exercise.equipment,
          compound: Boolean(exercise.compound),
          force: exercise.force,
          category: Array.isArray(exercise.category) ? exercise.category : [],
          possibleInjuries: Array.isArray(exercise.possibleInjuries) ? exercise.possibleInjuries : [],
          formTips: Array.isArray(exercise.formTips) ? exercise.formTips : [],
          createdAt: exercise.createdAt,
          updatedAt: exercise.updatedAt,
        };

        await logToInspector('info', {
          event: 'result',
          tool: searchExerciseByIdToolDefinition.name,
          exerciseId: result.id,
        });

        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, data: result }) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        await logToInspector('error', {
          event: 'error',
          tool: searchExerciseByIdToolDefinition.name,
          message,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ code: 'SEARCH_EXERCISE_BY_ID_FAILED', message }),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
