import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';

interface ToolResult {
  success: boolean;
  message: string;
  data?: {
    profileUrl: string;
    postLiked: boolean;
    postTitle?: string | undefined;
  };
  sessionId?: string | undefined;
}

interface Config {
  identityId: string;
  profileUrl: string;
}

function getConfig(): Config {
  const identityId = process.env['ANCHOR_IDENTITY_ID'];
  const profileUrl = process.env['LINKEDIN_PROFILE_URL'];

  if (!identityId) {
    throw new Error('ANCHOR_IDENTITY_ID environment variable is required');
  }
  if (!profileUrl) {
    throw new Error('LINKEDIN_PROFILE_URL environment variable is required');
  }

  if (!profileUrl.includes('linkedin.com/in/')) {
    throw new Error('LINKEDIN_PROFILE_URL must be a valid LinkedIn profile URL (e.g., https://www.linkedin.com/in/username)');
  }

  return { identityId, profileUrl };
}

function getAnchorClient(): Anchorbrowser {
  return new AnchorBrowser();
}

async function createAuthenticatedSession(client: Anchorbrowser, identityId: string): Promise<string> {
  console.log('[LINKEDIN] Creating authenticated session with identity:', identityId);

  const session = await client.sessions.create({
    session: {
      proxy: { active: true },
    },
    browser: {
      extra_stealth: { active: true },
      adblock: { active: true },
    },
    identities: [{ id: identityId }],
  });

  const sessionId = session.data?.id;
  if (!sessionId) {
    throw new Error('Failed to create session: No session ID returned');
  }

  console.log('[LINKEDIN] Session created:', sessionId);
  return sessionId;
}

const LIKE_FIRST_POST_PROMPT = `You are on LinkedIn's main feed page and already logged in. Your task is to navigate to a specific profile and like their first post.

TARGET PROFILE URL: {{PROFILE_URL}}

STEPS:
1. You should be on the LinkedIn feed. Verify you're logged in (you should see your profile picture or the navigation bar).
2. Navigate to the target profile URL by entering it in the browser's address bar or clicking on the URL bar and typing the profile URL.
3. Wait for the profile page to fully load.
4. Scroll down slightly to see the "Activity" or "Posts" section on the profile.
5. Find the first post by this person (not shared content, their own post if possible).
6. Click the "Like" button (thumbs up icon) on that post.
7. Verify the like was registered (the button should be highlighted/filled).

IMPORTANT:
- If you see a login prompt, that means authentication failed - report this.
- If there are no posts, report that no posts were found.
- If the like button is already filled/highlighted, the post is already liked - that's fine, report success.
- Do NOT click on the post itself, only the Like button.
- Be careful not to click "React" options other than Like.

Return your result as JSON.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    postLiked: {
      type: 'boolean',
      description: 'Whether the post was successfully liked (or was already liked)',
    },
    postTitle: {
      type: 'string',
      description: 'Brief description or first few words of the post that was liked',
    },
    alreadyLiked: {
      type: 'boolean',
      description: 'Whether the post was already liked before this action',
    },
    errorReason: {
      type: 'string',
      description: 'If failed, the reason why (e.g., "no posts found", "login required")',
    },
  },
  required: ['postLiked'],
};

export default async function likeFirstPost(): Promise<ToolResult> {
  let sessionId: string | undefined;

  try {
    const config = getConfig();
    const client = getAnchorClient();

    console.log('[LINKEDIN] Starting task: Like first post on profile');
    console.log('[LINKEDIN] Profile URL:', config.profileUrl);

    sessionId = await createAuthenticatedSession(client, config.identityId);

    console.log('[LINKEDIN] Executing agent task...');

    const prompt = LIKE_FIRST_POST_PROMPT.replace('{{PROFILE_URL}}', config.profileUrl);

    const result = await client.agent.task(prompt, {
      sessionId,
      taskOptions: {
        url: 'https://www.linkedin.com/feed/',
        outputSchema: OUTPUT_SCHEMA,
        maxSteps: 40,
      },
    });

    console.log('[LINKEDIN] Agent task completed');

    const output = parseAgentResult(result);
    const postLiked = output['postLiked'] as boolean | undefined;
    const alreadyLiked = output['alreadyLiked'] as boolean | undefined;
    const postTitle = output['postTitle'] as string | undefined;
    const errorReason = output['errorReason'] as string | undefined;

    if (postLiked) {
      const message = alreadyLiked
        ? `Post was already liked on ${config.profileUrl}`
        : `Successfully liked post on ${config.profileUrl}`;

      return {
        success: true,
        message,
        data: {
          profileUrl: config.profileUrl,
          postLiked: true,
          postTitle,
        },
        sessionId,
      };
    }

    return {
      success: false,
      message: errorReason || 'Failed to like post',
      data: {
        profileUrl: config.profileUrl,
        postLiked: false,
      },
      sessionId,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[LINKEDIN] Error:', errorMessage);

    return {
      success: false,
      message: errorMessage,
      sessionId,
    };
  }
}

function parseAgentResult(result: unknown): Record<string, unknown> {
  if (typeof result === 'string') {
    try {
      return JSON.parse(result);
    } catch {
      return { postLiked: false, errorReason: result };
    }
  }

  if (result && typeof result === 'object') {
    if ('result' in result) {
      return (result as { result: Record<string, unknown> }).result;
    }
    return result as Record<string, unknown>;
  }

  return { postLiked: false, errorReason: 'Unknown result format' };
}
