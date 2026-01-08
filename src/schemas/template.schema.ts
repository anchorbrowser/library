import { z } from 'zod';
import { AuthMethodTypeSchema } from '../types';

export const TemplateTypeSchema = z.enum(['auth', 'tool']);

export const TemplateJsonSchema = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1),
  description: z.string(),
  type: TemplateTypeSchema,
  file: z.string().min(1).regex(/\.ts$/, 'file must be a .ts file'),
  app: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
  }),
  requiredCredentials: z.array(AuthMethodTypeSchema).optional(),
  optionalCredentials: z.array(AuthMethodTypeSchema).optional(),
  tags: z.array(z.string()).optional(),
});

export type TemplateJson = z.infer<typeof TemplateJsonSchema>;
export type TemplateType = z.infer<typeof TemplateTypeSchema>;

