import type { AuthFlow } from '../../../../types';

export const authFlows: Record<string, AuthFlow> = {
  'basic-login': {
    name: 'Basic Login',
    description:
      'Login to ComplyAdvantage Mesh using an organization, username, and password via Auth0.',
    requiredCredentials: ['username_password', 'custom'],
    optionalCredentials: [],
  },
};
