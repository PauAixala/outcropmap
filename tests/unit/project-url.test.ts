import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPOSITORY_URL } from '@app/project';

/**
 * The repository URL lives in one constant (`src/app/project.ts`) so that renaming or moving the
 * repository is a one-line change. The header reads it; this fails if a literal copy of the URL
 * reappears in code. Docs may quote it freely.
 */
const ROOT = process.cwd();
const CODE = /\.(ts|mts|mjs|js|html|json)$/;

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.cache' || entry === 'data') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, found);
    else if (CODE.test(entry)) found.push(full);
  }
  return found;
}

describe('the repository URL', () => {
  it('is a plain https URL', () => {
    expect(REPOSITORY_URL).toMatch(/^https:\/\/[^\s'"]+$/);
  });

  it('is written out only in src/app/project.ts', () => {
    const files = [
      ...walk(join(ROOT, 'src')),
      ...walk(join(ROOT, 'tools')),
      ...readdirSync(ROOT)
        .filter((name) => name.endsWith('.html'))
        .map((name) => join(ROOT, name)),
    ];
    const copies = files
      .filter((file) => readFileSync(file, 'utf8').includes(REPOSITORY_URL))
      .map((file) => relative(ROOT, file).replaceAll('\\', '/'));
    expect(copies).toEqual(['src/app/project.ts']);
  });
});
