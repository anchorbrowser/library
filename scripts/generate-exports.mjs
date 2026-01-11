#!/usr/bin/env node
/**
 * Generates a single SDK file with nested object exports.
 *
 * Rules:
 * - app.json defines an "app boundary" - can be at any level
 * - template.json files are at leaf level (inside auth/, tools/, etc.)
 * - Each template inherits from nearest app.json walking up the tree
 * - Directory structure determines SDK nesting
 *
 * Usage: node scripts/generate-exports.mjs
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import { APPS_DIR, findFilesRecursive, findNearestAppJson } from './utils.mjs';

const SDK_DIR = 'src/sdk';
const SDK_INDEX = `${SDK_DIR}/index.ts`;

const GENERATED_HEADER = `// AUTO-GENERATED - DO NOT EDIT MANUALLY
// Run: node scripts/generate-exports.mjs

`;

function toCamelCase(str) {
  return str.replace(/-([a-z0-9])/gi, (_, c) => c.toUpperCase());
}

function toImportName(parts) {
  return parts.map((part, i) => {
    const camel = toCamelCase(part);
    return i === 0 ? camel : camel.charAt(0).toUpperCase() + camel.slice(1);
  }).join('');
}

function cleanSdkDir() {
  if (existsSync(SDK_DIR)) {
    rmSync(SDK_DIR, { recursive: true });
  }
  mkdirSync(SDK_DIR, { recursive: true });
}

function processApp(appJsonPath, processedApps, imports, sdkStructure, appPathFromRoot) {
  if (processedApps.has(appJsonPath)) return;
  const appJson = JSON.parse(readFileSync(appJsonPath, 'utf-8'));
  const appImportName = toImportName([...appPathFromRoot, 'app']);
  const appRelPath = relative(SDK_DIR, appJsonPath);
  imports.push(`import ${appImportName} from '${appRelPath}';`);
  setNestedValue(sdkStructure, appPathFromRoot, 'app', appImportName);
  processedApps.set(appJsonPath, { appJson, appImportName, appPathFromRoot });
  console.log(`App: ${appPathFromRoot.join('/')} → ${appImportName}`);
}

function setNestedValue(obj, pathArray, key, value) {
  let current = obj;
  for (const part of pathArray) {
    current[part] = current[part] || {};
    current = current[part];
  }
  current[key] = value;
}

function objectToCode(obj, indent = 2) {
  const spaces = ' '.repeat(indent);
  const entries = Object.entries(obj);

  if (entries.length === 0) return '{}';

  const lines = entries.map(([key, value]) => {
    if (typeof value === 'string') {
      return `${spaces}${key}: ${value},`;
    } else {
      return `${spaces}${key}: ${objectToCode(value, indent + 2)},`;
    }
  });

  return `{\n${lines.join('\n')}\n${' '.repeat(indent - 2)}}`;
}

function main() {
  console.log('Generating SDK exports...\n');
  cleanSdkDir();

  const templateFiles = findFilesRecursive(APPS_DIR, /\.template\.json$/);
  console.log(`Found ${templateFiles.length} template(s)\n`);

  const imports = [];
  const sdkStructure = {};
  const processedApps = new Map();

  for (const templatePath of templateFiles) {
    const templateJson = JSON.parse(readFileSync(templatePath, 'utf-8'));
    const templateDir = dirname(templatePath);
    // Find nearest app.json from the bottom up
    const appJsonPath = findNearestAppJson(templateDir);
    if (!appJsonPath) {
      console.warn(`No app.json found for ${templatePath}, skipping`);
      continue;
    }
    const appDir = dirname(appJsonPath); // (Linkedin: src/apps/linkedin)
    const appPathFromRoot = relative(APPS_DIR, appDir).split('/').filter(Boolean);
    const templatePathFromApp = relative(appDir, templateDir).split('/').filter(Boolean);
    const fullSdkPath = [...appPathFromRoot, ...templatePathFromApp];
    processApp(appJsonPath, processedApps, imports, sdkStructure, appPathFromRoot);
    const slug = templateJson.slug;
    const scriptFile = templateJson.file.replace(/\.ts$/, '');
    const scriptPath = join(templateDir, scriptFile);
    const scriptRelPath = relative(SDK_DIR, scriptPath);
    const metaRelPath = relative(SDK_DIR, templatePath);
    const baseName = toImportName([...fullSdkPath, slug]);
    const scriptImportName = baseName;
    const metaImportName = `${baseName}Meta`;
    imports.push(`import ${scriptImportName} from '${scriptRelPath}';`);
    imports.push(`import ${metaImportName} from '${metaRelPath}';`);
    const exportName = toCamelCase(slug);
    setNestedValue(sdkStructure, fullSdkPath, exportName, scriptImportName);
    setNestedValue(sdkStructure, fullSdkPath, `${exportName}Meta`, metaImportName);
    console.log(`Template: ${fullSdkPath.join('/')}/${slug} → ${scriptImportName}`);
  }
  // Generate exports
  const exports = Object.entries(sdkStructure).map(([key, value]) => {
    const exportName = toCamelCase(key);
    return `export const ${exportName} = ${objectToCode(value)};`;
  });
  // Write SDK index
  const content = GENERATED_HEADER + imports.join('\n') + '\n\n' + exports.join('\n\n') + '\n';
  writeFileSync(SDK_INDEX, content);
  console.log(`\nGenerated: ${SDK_INDEX}`);
  console.log('\nDone!');
}

main();
