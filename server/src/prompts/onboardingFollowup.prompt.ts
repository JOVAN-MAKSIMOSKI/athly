import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

type OnboardingPromptArgs = {
  split?: string;
};

function normalizeSplitLabel(split?: string): string | null {
  if (typeof split !== 'string') {
    return null;
  }

  const trimmed = split.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildOnboardingFollowupText(split?: string): string {
  const splitLabel = normalizeSplitLabel(split);
  const openingLine = splitLabel
    ? `Great choice with ${splitLabel}. Let us finish onboarding with 2 quick check-ins so I can coach safely and accurately.`
    : 'Great choice on your split. Let us finish onboarding with 2 quick check-ins so I can coach safely and accurately.';

  return [
    openingLine,
    '',
    '1. Any injuries, pain, soreness, or movement restrictions I should program around?',
    '2. How is your current energy and recovery (sleep, stress, fatigue)?',
    '',
    'Reply in one message and I will personalize your next sessions.',
  ].join('\n');
}

export function registerOnboardingFollowupPrompt(server: McpServer) {
  server.registerPrompt(
    'onboarding-followup',
    {
      title: 'Onboarding Follow-up',
      description: 'Post-split onboarding kickoff message aligned with onboarding skill contract.',
    },
    async (args: OnboardingPromptArgs = {}) => {
      return {
        messages: [
          {
            role: 'assistant',
            content: {
              type: 'text',
              text: buildOnboardingFollowupText(args.split),
            },
          },
        ],
      };
    }
  );
}
