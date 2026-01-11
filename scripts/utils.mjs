/**
 * Shared utilities for library scripts.
 */

import { existsSync, readdirSync } from 'fs';
import { dirname, join } from 'path';

export const APPS_DIR = 'src/apps';

export function findFilesRecursive(dir, pattern, results = []) {
  if (!existsSync(dir)) return results;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      findFilesRecursive(fullPath, pattern, results);
    } else if (pattern.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

export function findNearestAppJson(templateDir) {
  let current = templateDir;
  while (current.startsWith(APPS_DIR) && current !== APPS_DIR) {
    const appJsonPath = join(current, 'app.json');
    if (existsSync(appJsonPath)) {
      return appJsonPath;
    }
    current = dirname(current);
  }
}

