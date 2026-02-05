// AUTO-GENERATED - DO NOT EDIT MANUALLY
// Run: node scripts/generate-exports.mjs

import complyAdvantageMeshApp from '../apps/comply-advantage/mesh/app.json';
import complyAdvantageMeshAuthBasicLogin from '../apps/comply-advantage/mesh/auth/basic-login';
import complyAdvantageMeshAuthBasicLoginMeta from '../apps/comply-advantage/mesh/auth/basic-login.template.json';
import facebookApp from '../apps/facebook/app.json';
import facebookAuthAuthFacebook from '../apps/facebook/auth/auth-facebook';
import facebookAuthAuthFacebookMeta from '../apps/facebook/auth/auth-facebook.template.json';
import facebookToolSendMessageFacebook from '../apps/facebook/tool/send-message-facebook';
import facebookToolSendMessageFacebookMeta from '../apps/facebook/tool/send-message-facebook.template.json';
import linkedinApp from '../apps/linkedin/app.json';
import linkedinAuthBasic2faLogin from '../apps/linkedin/auth/basic-2fa-login';
import linkedinAuthBasic2faLoginMeta from '../apps/linkedin/auth/basic-2fa-login.template.json';
import linkedinToolReadPendingMessages from '../apps/linkedin/tool/read-pending-messages';
import linkedinToolReadPendingMessagesMeta from '../apps/linkedin/tool/read-pending-messages.template.json';
import openAiApp from '../apps/open-ai/app.json';
import openAiAuthMailAndPassword from '../apps/open-ai/auth/mail-and-password';
import openAiAuthMailAndPasswordMeta from '../apps/open-ai/auth/mail-and-password.template.json';
import openAiToolGetInvoices from '../apps/open-ai/tool/get-invoices';
import openAiToolGetInvoicesMeta from '../apps/open-ai/tool/get-invoices.template.json';

export const complyAdvantage = {
  mesh: {
    app: complyAdvantageMeshApp,
    auth: {
      basicLogin: complyAdvantageMeshAuthBasicLogin,
      basicLoginMeta: complyAdvantageMeshAuthBasicLoginMeta,
    },
  },
};

export const facebook = {
  app: facebookApp,
  auth: {
    authFacebook: facebookAuthAuthFacebook,
    authFacebookMeta: facebookAuthAuthFacebookMeta,
  },
  tool: {
    sendMessageFacebook: facebookToolSendMessageFacebook,
    sendMessageFacebookMeta: facebookToolSendMessageFacebookMeta,
  },
};

export const linkedin = {
  app: linkedinApp,
  auth: {
    basic2faLogin: linkedinAuthBasic2faLogin,
    basic2faLoginMeta: linkedinAuthBasic2faLoginMeta,
  },
  tool: {
    readPendingMessages: linkedinToolReadPendingMessages,
    readPendingMessagesMeta: linkedinToolReadPendingMessagesMeta,
  },
};

export const openAi = {
  app: openAiApp,
  auth: {
    mailAndPassword: openAiAuthMailAndPassword,
    mailAndPasswordMeta: openAiAuthMailAndPasswordMeta,
  },
  tool: {
    getInvoices: openAiToolGetInvoices,
    getInvoicesMeta: openAiToolGetInvoicesMeta,
  },
};
