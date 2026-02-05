import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const SchemaParameterSchema = z.object({
  displayName: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'date']),
  required: z.boolean().optional(),
  description: z.string().optional(),
  defaultValue: z.string().optional(),
});

const ToolDetailsSchema = z.object({
  applicationUrl: z.string().url(),
  goal: z.string().min(1),
  inputSchema: z.array(SchemaParameterSchema),
  outputSchema: z.array(SchemaParameterSchema),
});

const ConfigSchema = z
  .object({
    sessionId: z.string().optional(),
    identityId: z.string().optional(),
    toolDetails: ToolDetailsSchema,
    toolInput: z.record(z.string(), z.unknown()),
  })
  .refine((data) => data.sessionId || data.identityId, {
    message: 'Either ANCHOR_SESSION_ID or ANCHOR_IDENTITY_ID must be provided',
  });

type Config = z.infer<typeof ConfigSchema>;
type ToolDetails = z.infer<typeof ToolDetailsSchema>;
type SchemaParameter = z.infer<typeof SchemaParameterSchema>;

interface ToolResult {
  success: boolean;
  output?: Record<string, unknown>;
  error?: string;
  sessionId?: string;
}

function getConfig(): Config {
  const toolDetailsRaw = process.env['ANCHOR_TOOL_DETAILS'];
  const toolInputRaw = process.env['ANCHOR_TOOL_INPUT'];

  if (!toolDetailsRaw) {
    throw new Error('ANCHOR_TOOL_DETAILS environment variable is required');
  }
  if (!toolInputRaw) {
    throw new Error('ANCHOR_TOOL_INPUT environment variable is required');
  }

  let toolDetails: unknown;
  let toolInput: unknown;

  try {
    toolDetails = JSON.parse(toolDetailsRaw);
  } catch {
    throw new Error('ANCHOR_TOOL_DETAILS must be valid JSON');
  }

  try {
    toolInput = JSON.parse(toolInputRaw);
  } catch {
    throw new Error('ANCHOR_TOOL_INPUT must be valid JSON');
  }

  return ConfigSchema.parse({
    sessionId: process.env['ANCHOR_SESSION_ID'] || undefined,
    identityId: process.env['ANCHOR_IDENTITY_ID'],
    toolDetails,
    toolInput,
  });
}

function getAnchorClient(): Anchorbrowser {
  return new AnchorBrowser();
}

function validateInput(input: Record<string, unknown>, schema: SchemaParameter[]): void {
  for (const param of schema) {
    const value = input[param.displayName];
    const isRequired = param.required !== false;

    if (isRequired && (value === undefined || value === null || value === '')) {
      throw new Error(`Missing required input parameter: ${param.displayName}`);
    }

    if (value !== undefined && value !== null) {
      switch (param.type) {
        case 'string':
          if (typeof value !== 'string') {
            throw new Error(`Parameter ${param.displayName} must be a string`);
          }
          break;
        case 'number':
          if (typeof value !== 'number' && isNaN(Number(value))) {
            throw new Error(`Parameter ${param.displayName} must be a number`);
          }
          break;
        case 'boolean':
          if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
            throw new Error(`Parameter ${param.displayName} must be a boolean`);
          }
          break;
        case 'date':
          if (isNaN(Date.parse(String(value)))) {
            throw new Error(`Parameter ${param.displayName} must be a valid date`);
          }
          break;
      }
    }
  }
}

function parseAgentResult(result: unknown): Record<string, unknown> {
  if (typeof result === 'string') {
    try {
      return JSON.parse(result);
    } catch {
      return { result };
    }
  }

  if (result && typeof result === 'object' && 'result' in result) {
    return (result as { result: Record<string, unknown> }).result;
  }

  return result as Record<string, unknown>;
}

function validateOutput(result: unknown, schema: SchemaParameter[]): Record<string, unknown> {
  const output = parseAgentResult(result);
  const validated: Record<string, unknown> = {};

  for (const param of schema) {
    const value = output[param.displayName];
    const isRequired = param.required !== false;

    if (isRequired && (value === undefined || value === null)) {
      throw new Error(`Missing required output parameter: ${param.displayName}`);
    }

    if (value !== undefined && value !== null) {
      validated[param.displayName] = value;
    } else if (param.defaultValue !== undefined) {
      validated[param.displayName] = param.defaultValue;
    }
  }

  return validated;
}

function buildAgentPrompt(toolDetails: ToolDetails, input: Record<string, unknown>): string {
  const inputDescription = toolDetails.inputSchema
    .map((p) => `- ${p.displayName}: ${input[p.displayName] ?? p.defaultValue ?? 'not provided'}`)
    .join('\n');

  const outputDescription = toolDetails.outputSchema
    .map(
      (p) =>
        `- ${p.displayName} (${p.type}${p.required === false ? ', optional' : ''}): ${p.description || 'no description'}`
    )
    .join('\n');

  return `You are executing an automated web task. Follow these instructions precisely and efficiently.

GOAL: go to https://platform.openai.com, navigate to billing, and get the invoices for the specified time range.

INPUT VALUES:
${inputDescription}

EXPECTED OUTPUT FORMAT:
Return a JSON object with these fields:
${outputDescription}

INSTRUCTIONS:
1. Navigate and interact with the web application to complete the goal
2. Use the search functionality when available to find items quickly
3. Be precise and efficient - avoid unnecessary actions
4. Extract the required output data as specified above
5. If you encounter an error or cannot complete the task, return an error message

IMPORTANT:
- Do NOT ask for clarification - use the provided input values
- Do NOT deviate from the goal
- Complete the task as quickly as possible
- Return ONLY the JSON output object when done`;
}

function buildOutputSchema(schema: SchemaParameter[]): object {
  const properties: Record<string, object> = {};
  const required: string[] = [];

  for (const param of schema) {
    let type: string;
    switch (param.type) {
      case 'number':
        type = 'number';
        break;
      case 'boolean':
        type = 'boolean';
        break;
      case 'date':
        type = 'string';
        break;
      default:
        type = 'string';
    }

    properties[param.displayName] = {
      type,
      description: param.description || param.displayName,
    };

    if (param.required !== false) {
      required.push(param.displayName);
    }
  }

  return {
    type: 'object',
    properties,
    required,
  };
}

async function getOrCreateSession(
  client: Anchorbrowser,
  existingSessionId?: string,
  identityId?: string
): Promise<string> {
  if (existingSessionId) {
    console.log('[TOOL] Using existing session:', existingSessionId);
    return existingSessionId;
  }

  if (!identityId) {
    throw new Error('Either ANCHOR_SESSION_ID or ANCHOR_IDENTITY_ID must be provided');
  }

  console.log('[TOOL] Creating new browser session with identity:', identityId);

  const session = await client.sessions.create({
    session: {
      proxy: {
        active: true,
      },
    },
    browser: {
      extra_stealth: {
        active: true,
      },
    },
    identities: [{ id: identityId }],
  });

  if (!session.data?.id) {
    throw new Error('Failed to create session: No session ID returned');
  }

  console.log('[TOOL] Session created:', session.data.id);
  return session.data.id;
}

export default async function runAgenticTool(): Promise<ToolResult> {
  let sessionId: string | undefined;

  try {
    const config = getConfig();
    const client = getAnchorClient();

    // Validate input against schema
    console.log('[TOOL] Validating input...');
    validateInput(config.toolInput, config.toolDetails.inputSchema);

    // Get or create session
    sessionId = await getOrCreateSession(client, config.sessionId, config.identityId);

    // Build optimized prompt
    const prompt = buildAgentPrompt(config.toolDetails, config.toolInput);
    const outputSchema = buildOutputSchema(config.toolDetails.outputSchema);

    console.log('[TOOL] Executing agent task...');
    console.log('[TOOL] Goal:', config.toolDetails.goal);

    // Execute the agent task
    const result = await client.agent.task(prompt, {
      sessionId,
      taskOptions: {
        url: config.toolDetails.applicationUrl,
        outputSchema,
        maxSteps: 50,
      },
    });

    console.log('[TOOL] Agent task completed');

    // Validate output against schema
    console.log('[TOOL] Validating output...');
    const validatedOutput = validateOutput(result, config.toolDetails.outputSchema);

    return {
      success: true,
      output: validatedOutput,
      sessionId,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[TOOL] Error:', errorMessage);

    return {
      success: false,
      error: errorMessage,
      sessionId: sessionId || '',
    };
  }
}
