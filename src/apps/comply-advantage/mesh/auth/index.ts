import type { AuthFlow } from '../../../../types';

export const authFlows: Record<string, AuthFlow> = {
  'basic-login': {
    name: 'Basic Login',
    description:
      'Login to ComplyAdvantage Mesh using organization, username, and password via Auth0',
    requiredMethods: ['username_password', 'custom'],
    optionalMethods: [],
  },
};
