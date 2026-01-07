import type { GenericAuthFlow } from '../../types';

export const authFlows: Record<string, GenericAuthFlow> = {
  'agentic-login': {
    name: 'Agentic Login',
    description:
      'AI agent-based login that works with any application using stored identity credentials',
  },
};
