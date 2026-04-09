import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { UserModel } from '../../database/models/UserSchema.js';
import { ensureUserExperienceLevel } from '../../domain/users/experienceProgression.js';

type ToolTextContent = { type: 'text'; text: string };

type ToolResponse = {
  content: ToolTextContent[];
  isError?: true;
};

const ObjectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Expected a 24-character hex ObjectId')
  .describe('MongoDB ObjectId string reference');

const GetUserProfileInputSchema = z
  .object({
    userId: ObjectIdSchema.describe('User ObjectId to fetch the profile for.'),
  })
  .describe('Inputs for fetching a user profile and preferences.');

const getUserProfileToolDefinition = {
  name: 'athly.get_user_profile',
  description: 'Fetches a user profile with preferences by user id. RESPONSE FORMAT: Return JSON only in content[0].text with {"success":true,"data":{...},"autoPromotedToIntermediate":boolean} on success, or {"code":"...","message":"..."} with isError=true on failure. Do not include markdown, emojis, or narrative text.',
  inputSchema: GetUserProfileInputSchema,
  restricted: false,
};

export function registerUserProfileTool(server: McpServer) {
  const logToInspector = async (level: 'debug' | 'info' | 'warning' | 'error', data: unknown) => {
    try {
      await server.sendLoggingMessage({
        level,
        logger: getUserProfileToolDefinition.name,
        data,
      });
    } catch {
      // Best-effort logging only.
    }
  };

  server.registerTool(
    getUserProfileToolDefinition.name,
    {
      description: getUserProfileToolDefinition.description,
      inputSchema: getUserProfileToolDefinition.inputSchema,
    },
    async (args): Promise<ToolResponse> => {
      try {
        const parsed = GetUserProfileInputSchema.parse(args);
        await logToInspector('debug', { event: 'input', payload: parsed });

        const user = await UserModel.findById(parsed.userId)
          .select('-password')
          .lean();

        if (!user) {
          await logToInspector('info', { event: 'not_found', userId: parsed.userId });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ code: 'USER_NOT_FOUND', message: 'User not found' }),
              },
            ],
            isError: true,
          };
        }

        const progression = await ensureUserExperienceLevel(user);
        const responseUser = progression.promoted
          ? {
              ...user,
              profile: {
                ...user.profile,
                experienceLevel: progression.experienceLevel,
              },
            }
          : user;

        await logToInspector('info', {
          event: 'result',
          userId: parsed.userId,
          autoPromotedToIntermediate: progression.promoted,
        });

        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, data: responseUser, autoPromotedToIntermediate: progression.promoted }) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        await logToInspector('error', { event: 'error', message });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ code: 'GET_USER_PROFILE_FAILED', message }),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
