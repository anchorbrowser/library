#!/usr/bin/env node
/**
 * Validates app.json and *.template.json files.
 *
 * Rules:
 * - Every template.json must have a corresponding app.json in its directory tree
 * - app.json must have: id, name, description, allowedDomains
 * - template.json must have: slug, name, type, file, app
 * - template.file must point to an existing .ts file
 * - template.type must match the parent directory (auth, tool)
 * - template.slug must match the filename (without .template.json)
 * - template.app must match the nearest app.json's id
 * - inputSchema/outputSchema (if present) must be arrays of SchemaParameter:
 *   { display_name: string, type: 'string'|'number'|'boolean'|'date', required?: boolean, description?: string, default_value?: string }
 *
 * Usage: node scripts/validate-templates.mjs
 */

import { existsSync, readFileSync } from 'fs';
import { basename, dirname, join, relative } from 'path';
import { APPS_DIR, findFilesRecursive, findNearestAppJson } from './utils.mjs';

const APP_REQUIRED_FIELDS = ['id', 'name', 'description', 'allowedDomains'];
const TEMPLATE_REQUIRED_FIELDS = ['slug', 'name', 'type', 'file', 'app'];
const VALID_TEMPLATE_TYPES = ['auth', 'tool'];
const VALID_SCHEMA_PARAM_TYPES = ['string', 'number', 'boolean', 'date'];

function validateSchemaParameter(param, index, schemaName) {
  const errors = [];
  const prefix = `${schemaName}[${index}]`;

  if (typeof param !== 'object' || param === null) {
    errors.push(`${prefix}: must be an object`);
    return errors;
  }

  // Required: display_name
  if (param.display_name === undefined || param.display_name === null) {
    errors.push(`${prefix}: missing required field "display_name"`);
  } else if (typeof param.display_name !== 'string') {
    errors.push(`${prefix}.display_name: must be a string`);
  }

  // Required: type
  if (param.type === undefined || param.type === null) {
    errors.push(`${prefix}: missing required field "type"`);
  } else if (!VALID_SCHEMA_PARAM_TYPES.includes(param.type)) {
    errors.push(`${prefix}.type: must be one of: ${VALID_SCHEMA_PARAM_TYPES.join(', ')}`);
  }

  // Optional: required (boolean)
  if (param.required !== undefined && typeof param.required !== 'boolean') {
    errors.push(`${prefix}.required: must be a boolean`);
  }

  // Optional: description (string)
  if (param.description !== undefined && typeof param.description !== 'string') {
    errors.push(`${prefix}.description: must be a string`);
  }

  // Optional: default_value (string)
  if (param.default_value !== undefined && typeof param.default_value !== 'string') {
    errors.push(`${prefix}.default_value: must be a string`);
  }

  return errors;
}

function validateSchema(schema, schemaName) {
  const errors = [];

  if (schema === null || schema === undefined) {
    return errors; // Optional field, no errors if missing
  }

  if (!Array.isArray(schema)) {
    errors.push(`${schemaName}: must be an array or null`);
    return errors;
  }

  schema.forEach((param, index) => {
    errors.push(...validateSchemaParameter(param, index, schemaName));
  });

  return errors;
}

function validateAppJson(filePath) {
  const errors = [];

  try {
    const content = readFileSync(filePath, 'utf-8');
    const json = JSON.parse(content);

    for (const field of APP_REQUIRED_FIELDS) {
      if (json[field] === undefined || json[field] === null) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    if (json.id && typeof json.id !== 'string') {
      errors.push('Field "id" must be a string');
    }

    if (json.name && typeof json.name !== 'string') {
      errors.push('Field "name" must be a string');
    }

    if (json.description && typeof json.description !== 'string') {
      errors.push('Field "description" must be a string');
    }

    if (json.allowedDomains) {
      if (!Array.isArray(json.allowedDomains)) {
        errors.push('Field "allowedDomains" must be an array');
      } else if (json.allowedDomains.length === 0) {
        errors.push('Field "allowedDomains" must not be empty');
      } else if (!json.allowedDomains.every((d) => typeof d === 'string')) {
        errors.push('Field "allowedDomains" must contain only strings');
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Unknown parse error');
  }

  return { valid: errors.length === 0, errors };
}

function getExpectedSlug(filePath) {
  // basic-login.template.json → basic-login
  const fileName = basename(filePath);
  return fileName.replace('.template.json', '');
}

function getTypeDir(filePath) {
  // src/apps/linkedin/auth/basic-login.template.json → auth
  // src/apps/bamboohr/tools/request-time-off.template.json → tool
  const dir = dirname(filePath);
  const dirName = basename(dir);
  // Normalize plural directory names to singular type (tools → tool)
  if (dirName === 'tools') return 'tool';
  return dirName;
}

function validateTemplateJson(filePath) {
  const errors = [];

  try {
    const content = readFileSync(filePath, 'utf-8');
    const json = JSON.parse(content);
    const templateDir = dirname(filePath);

    // Required fields
    for (const field of TEMPLATE_REQUIRED_FIELDS) {
      if (json[field] === undefined || json[field] === null) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Type checks
    if (json.slug && typeof json.slug !== 'string') {
      errors.push('Field "slug" must be a string');
    }

    if (json.name && typeof json.name !== 'string') {
      errors.push('Field "name" must be a string');
    }

    if (json.type && !VALID_TEMPLATE_TYPES.includes(json.type)) {
      errors.push(`Field "type" must be one of: ${VALID_TEMPLATE_TYPES.join(', ')}`);
    }

    // File exists check
    if (json.file) {
      if (typeof json.file !== 'string') {
        errors.push('Field "file" must be a string');
      } else {
        const scriptPath = join(templateDir, json.file);
        if (!existsSync(scriptPath)) {
          errors.push(`Script file not found: ${json.file}`);
        }
      }
    }

    // Slug must match filename
    if (json.slug) {
      const expectedSlug = getExpectedSlug(filePath);
      if (json.slug !== expectedSlug) {
        errors.push(`Slug mismatch: expected "${expectedSlug}", got "${json.slug}"`);
      }
    }

    // Type must match directory
    if (json.type) {
      const typeDir = getTypeDir(filePath);
      if (json.type !== typeDir) {
        errors.push(`Type mismatch: template says "${json.type}" but directory is "${typeDir}"`);
      }
    }

    // App field must be a string
    if (json.app && typeof json.app !== 'string') {
      errors.push('Field "app" must be a string');
    }

    // Must have app.json in tree and app field must match
    const appJsonPath = findNearestAppJson(templateDir);
    if (!appJsonPath) {
      errors.push('No app.json found in directory tree');
    } else if (json.app) {
      const appJson = JSON.parse(readFileSync(appJsonPath, 'utf-8'));
      if (json.app !== appJson.id) {
        errors.push(`App mismatch: template says "${json.app}" but app.json has id "${appJson.id}"`);
      }
    }

    // Validate inputSchema and outputSchema
    errors.push(...validateSchema(json.inputSchema, 'inputSchema'));
    errors.push(...validateSchema(json.outputSchema, 'outputSchema'));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Unknown parse error');
  }

  return { valid: errors.length === 0, errors };
}

function main() {
  console.log('Validating templates...\n');

  const appJsonFiles = findFilesRecursive(APPS_DIR, /^app\.json$/);
  const templateFiles = findFilesRecursive(APPS_DIR, /\.template\.json$/);

  if (appJsonFiles.length === 0 && templateFiles.length === 0) {
    console.log('No app.json or template.json files found in src/apps/');
    process.exit(0);
  }

  let hasErrors = false;
  const results = [];

  for (const file of appJsonFiles) {
    const relativePath = relative(process.cwd(), file);
    const result = validateAppJson(file);
    results.push({ path: relativePath, type: 'app', ...result });

    if (result.valid) {
      console.log(`✓ ${relativePath}`);
    } else {
      hasErrors = true;
      console.log(`✗ ${relativePath}`);
      result.errors.forEach((err) => console.log(`   └─ ${err}`));
    }
  }

  for (const file of templateFiles) {
    const relativePath = relative(process.cwd(), file);
    const result = validateTemplateJson(file);
    results.push({ path: relativePath, type: 'template', ...result });

    if (result.valid) {
      console.log(`✓ ${relativePath}`);
    } else {
      hasErrors = true;
      console.log(`✗ ${relativePath}`);
      result.errors.forEach((err) => console.log(`   └─ ${err}`));
    }
  }

  const validCount = results.filter((r) => r.valid).length;
  console.log(`\n📊 Results: ${validCount}/${results.length} valid`);

  if (hasErrors) {
    console.log('\n❌ Validation failed');
    process.exit(1);
  }

  console.log('\n✅ All files valid!');
}

main();
