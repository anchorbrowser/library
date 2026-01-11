// AUTO-GENERATED - DO NOT EDIT MANUALLY
// Run: node scripts/generate-exports.mjs

import complyAdvantageMeshApp from '../apps/comply-advantage/mesh/app.json';
import complyAdvantageMeshAuthBasicLogin from '../apps/comply-advantage/mesh/auth/basic-login';
import complyAdvantageMeshAuthBasicLoginMeta from '../apps/comply-advantage/mesh/auth/basic-login.template.json';
import linkedinApp from '../apps/linkedin/app.json';
import linkedinAuthBasic2faLogin from '../apps/linkedin/auth/basic-2fa-login';
import linkedinAuthBasic2faLoginMeta from '../apps/linkedin/auth/basic-2fa-login.template.json';

export const complyAdvantage = {
  mesh: {
    app: complyAdvantageMeshApp,
    auth: {
      basicLogin: complyAdvantageMeshAuthBasicLogin,
      basicLoginMeta: complyAdvantageMeshAuthBasicLoginMeta,
    },
  },
};

export const linkedin = {
  app: linkedinApp,
  auth: {
    basic2faLogin: linkedinAuthBasic2faLogin,
    basic2faLoginMeta: linkedinAuthBasic2faLoginMeta,
  },
};
