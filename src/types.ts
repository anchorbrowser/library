import { z } from 'zod';

/**
 * Supported authentication method types that can be required or optional for an auth flow.
 */
export const AuthMethodTypeSchema = z.enum(['username_password', 'authenticator', 'custom']);
export type AuthMethodType = z.infer<typeof AuthMethodTypeSchema>;

/**
 * Defines an authentication flow for an application.
 * Each flow specifies which auth methods are required vs optional.
 */
export const AuthFlowSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  requiredCredentials: z.array(AuthMethodTypeSchema),
  optionalCredentials: z.array(AuthMethodTypeSchema),
});
export type AuthFlow = z.infer<typeof AuthFlowSchema>;

/**
 * Defines a generic authentication flow that is method-agnostic.
 * Used for flows that work with any stored identity credentials.
 */
export const GenericAuthFlowSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
});
export type GenericAuthFlow = z.infer<typeof GenericAuthFlowSchema>;

/**
 * A tool that can be used with an application.
 * Extend this interface as tool requirements become clearer.
 */
export const AppToolSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
});
export type AppTool = z.infer<typeof AppToolSchema>;

/**
 * Defines an application that can be automated.
 */
export const ApplicationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  allowedDomains: z.array(z.string().min(1)),
  authFlows: z.record(z.string(), AuthFlowSchema),
  tools: z.record(z.string(), AppToolSchema),
});
export type Application = z.infer<typeof ApplicationSchema>;

/**
 * Registry entry can be either an Application or a nested registry (for vendors with multiple products).
 * Examples:
 *   apps.linkedin -> Application
 *   apps.complyAdvantage.mesh -> Application
 *   apps.complyAdvantage.legacy -> Application
 */
export interface AppRegistry {
  [key: string]: Application | AppRegistry;
}

const baseAppRegistrySchema: z.ZodType<AppRegistry> = z.lazy(() =>
  z.record(z.string(), z.union([ApplicationSchema, baseAppRegistrySchema])),
);

export const AppRegistrySchema = baseAppRegistrySchema;
