import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Register a reusable system-level MCP prompt named `system-instructions`.
 *
 * @param server McpServer instance
 * @param instructions The system instructions text to register as the system message
 */
export function registerSystemInstructions(server: McpServer, instructions: string) {
  server.registerPrompt(
    'system-instructions',
    {
      title: 'System Instructions',
      // Metadata hint for clients so they can auto-load this prompt as the base system message
      description: 'Shared system instructions for MCP servers.',
      // Custom metadata flag; clients may inspect this field to auto-apply system messages
      isSystem: true as unknown as boolean,
    } as any,
    async () => {
      return {
        messages: [
          {
            role: 'assistant',
            content: {
              type: 'text',
              text: instructions,
            },
          },
        ],
      };
    }
  );
}
