import * as fs from 'fs';
import * as path from 'path';

/**
 * Task ID format: {category}.{name}
 * Example: auth.comply-advantage-basic
 *
 * Tasks are discovered dynamically by checking if the corresponding
 * .ts file exists under src/{category}/{name}.ts
 */

/**
 * Convert task ID to file path.
 * auth.comply-advantage-basic -> auth/comply-advantage-basic
 */
function taskIdToPath(taskId: string): string {
  return taskId.replaceAll('.', '/');
}

/**
 * Get the src/ directory path.
 * Works whether running from src/ (development) or dist/ (compiled).
 */
function getSrcDir(): string {
  // __dirname is either:
  // - src/utilities (when running from source)
  // - dist/utilities (when running compiled)
  // We need to get to the package root, then into src/
  const packageRoot = path.join(__dirname, '..', '..');

  return path.join(packageRoot, 'src');
}

/**
 * Check if a task ID corresponds to a predefined task.
 * Validates by checking if the corresponding .ts file exists.
 */
export function isPredefinedTask(taskId: string): boolean {
  try {
    const relativePath = taskIdToPath(taskId);
    const srcDir = getSrcDir();
    const filePath = path.join(srcDir, `${relativePath}.ts`);

    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

/**
 * Get predefined task TypeScript source code by its ID.
 * Returns the raw .ts source file content.
 */
export function getPredefinedTaskCodeByIdRaw(taskId: string): string {
  const relativePath = taskIdToPath(taskId);
  const srcDir = getSrcDir();
  const filePath = path.join(srcDir, `${relativePath}.ts`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Predefined task not found: ${taskId}`);
  }

  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Get predefined task TypeScript source code as base64 by its ID.
 */
export function getPredefinedTaskCodeById(taskId: string): string {
  const code = getPredefinedTaskCodeByIdRaw(taskId);

  return Buffer.from(code).toString('base64');
}
