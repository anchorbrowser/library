import { authFlows } from './auth';

import type { Application } from '../../types';

export const linkedin: Application = {
  id: 'linkedin',
  name: 'LinkedIn',
  description: 'LinkedIn is a professional networking platform.',
  allowedDomains: ['linkedin.com'],
  authFlows,
  tools: {},
};
