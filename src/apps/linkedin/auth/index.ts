import type { AuthFlow } from '../../../types';

export const authFlows: Record<string, AuthFlow> = {
  'basic-2fa-login': {
    name: 'Basic 2FA Login',
    description: 'Login to LinkedIn using a username and password; 2FA is optional.',
    requiredCredentials: ['username_password'],
    optionalCredentials: ['authenticator'],
  },
};
