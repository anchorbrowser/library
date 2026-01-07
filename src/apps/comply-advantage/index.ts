import { authFlows } from './mesh/auth';

import type { Application } from '../../types';

export const complyAdvantageMesh: Application = {
  id: 'comply-advantage-mesh',
  name: 'ComplyAdvantage Mesh',
  description: 'ComplyAdvantage Mesh is a compliance and risk management platform.',
  allowedDomains: ['mesh.complyadvantage.com'],
  authFlows,
  tools: {},
};
