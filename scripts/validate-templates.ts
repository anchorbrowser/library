#!/usr/bin/env npx tsx

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TemplateJsonSchema, type TemplateJson } from '../src/schemas/template.schema';
import { AuthMethodType, AuthMethodTypeSchema } from '../src/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPS_DIR = path.join(__dirname, '../src/apps');

interface PathInfo {
  topLevelDir: string;
  typeDir: string;
  pathWithoutType: string[];
}

function findTemplateJsonFiles(dir: string, files: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findTemplateJsonFiles(fullPath, files);
    } else if (entry.name === 'template.json') {
      files.push(fullPath);
    }
  }
  return files;
}

function normalize(str: string): string {
  return str.toLowerCase().replace(/[-\s]/g, '');
}

function fuzzyMatch(actual: string, expected: string): boolean {
  return normalize(actual) === normalize(expected);
}

function getPathInfo(templatePath: string): PathInfo {
  const relativePath = path.relative(APPS_DIR, templatePath);
  const parts = relativePath.split(path.sep);
  return {
    topLevelDir: parts[0],
    typeDir: parts[parts.length - 2],
    pathWithoutType: parts.slice(0, -2),
  };
}

function validateSlug(templateJson: TemplateJson, pathInfo: PathInfo): string | null {
  const expectedSlug = `${pathInfo.pathWithoutType.join('-')}-${templateJson.file.replace('.ts', '')}`;
  if (templateJson.slug !== expectedSlug) {
    return `slug mismatch: expected "${expectedSlug}", got "${templateJson.slug}"`;
  }
  return null;
}

function validateName(templateJson: TemplateJson): string | null {
  if (!templateJson.name) {
    return 'name is required';
  }
  const expectedBase = templateJson.file.replace('.ts', '');
  if (!fuzzyMatch(templateJson.name, expectedBase)) {
    return `name mismatch: "${templateJson.name}" doesn't match file "${expectedBase}"`;
  }
  return null;
}

function validateAppName(templateJson: TemplateJson, pathInfo: PathInfo): string | null {
  if (!fuzzyMatch(templateJson.app.name, pathInfo.topLevelDir)) {
    return `app.name mismatch: "${templateJson.app.name}" doesn't match directory "${pathInfo.topLevelDir}"`;
  }
  return null;
}

function validateDescription(templateJson: TemplateJson): string | null {
  if (!templateJson.description) {
    return `description is required`;
  }
  return null;
}

function validateType(templateJson: TemplateJson, pathInfo: PathInfo): string | null {
  if (pathInfo.typeDir !== templateJson.type) {
    return `type mismatch: template.json says "${templateJson.type}" but directory is "${pathInfo.typeDir}"`;
  }
  return null;
}

function validateFile(templateJson: TemplateJson, templatePath: string): string | null {
  const execFile = path.join(path.dirname(templatePath), templateJson.file);
  if (!fs.existsSync(execFile)) {
    return `file "${templateJson.file}" does not exist`;
  }
  return null;
}

function validateApp(templateJson: TemplateJson, pathInfo: PathInfo): string | null {
  if (templateJson.app.id !== pathInfo.topLevelDir) {
    return `app.id mismatch: should be "${pathInfo.topLevelDir}", got "${templateJson.app.id}"`;
  }
  return null;
}

function validateCredentials(templateCredentials?: AuthMethodType[]): string | null {
  if(!templateCredentials?.length) {
    return null;
  }
  for (const credential of templateCredentials) {
    if (!AuthMethodTypeSchema.parse(credential)) {
      return `requiredCredentials: invalid credential type: ${credential}`;
    }
  }
  return null;
}

function validateTemplateAgainstSource(templatePath: string, templateJson: TemplateJson): string[] {
  const errors: string[] = [];
  const pathInfo = getPathInfo(templatePath);

  const validators = [
    () => validateSlug(templateJson, pathInfo),
    () => validateName(templateJson),
    () => validateDescription(templateJson),
    () => validateType(templateJson, pathInfo),
    () => validateFile(templateJson, templatePath),
    () => validateApp(templateJson, pathInfo),
    () => validateAppName(templateJson, pathInfo),
    () => validateCredentials(templateJson.requiredCredentials),
    () => validateCredentials(templateJson.optionalCredentials),
  ];

  for (const validate of validators) {
    const error = validate();
    if (error) errors.push(error);
  }

  return errors;
}

function validateTemplate(filePath: string): { valid: boolean; errors?: string[] } {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const json = JSON.parse(content);

    const schemaResult = TemplateJsonSchema.safeParse(json);
    if (!schemaResult.success) {
      return {
        valid: false,
        errors: schemaResult.error.errors.map(e => `schema: ${e.path.join('.')}: ${e.message}`),
      };
    }

    const errors = validateTemplateAgainstSource(filePath, schemaResult.data);
    return errors.length > 0 ? { valid: false, errors } : { valid: true };
  } catch (error) {
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    };
  }
}

function main() {
  const templateFiles = findTemplateJsonFiles(APPS_DIR);
  if (templateFiles.length === 0) {
    console.log('No template.json files found in src/apps/');
    process.exit(0);
  }

  let hasErrors = false;
  const results: { path: string; valid: boolean; errors?: string[] }[] = [];

  for (const file of templateFiles) {
    const relativePath = path.relative(process.cwd(), file);
    const result = validateTemplate(file);
    results.push({ path: relativePath, ...result });

    if (result.valid) {
      console.log(`✓ ${relativePath}`);
    } else {
      hasErrors = true;
      console.log(`✗ ${relativePath}`);
      result.errors?.forEach(err => console.log(`   └─ ${err}`));
    }
  }

  console.log(`\n📊 Results: ${results.filter(r => r.valid).length}/${results.length} valid`);

  if (hasErrors) {
    process.exit(1);
  }

  console.log('All templates valid!');
}

main();
