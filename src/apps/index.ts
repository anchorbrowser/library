import { complyAdvantageMesh } from './comply-advantage';
import { linkedin } from './linkedin';

import type { AppRegistry } from '../types';

export const apps: AppRegistry = {
  linkedin,
  complyAdvantage: {
    mesh: complyAdvantageMesh,
  },
};
