#!/usr/bin/env node
/**
 * Clear the build output directories before Vite does.
 *
 * Vite empties its own output directory first, and on this working copy that once died in
 * `emptyDir` with EPERM — deleting was not permitted, renaming was, so the answer was to move the
 * old output into `_to_delete/` and let Vite create a fresh directory (AGENTS.md section 7).
 *
 * **Deleting works here now.** Measured on every path the note called blocked: a file in `dist/`, a
 * built asset, a file in `.git/`, and a recursive directory delete — all fine. So the delete is
 * tried first and the rename is the fallback, which is the same protection with none of the litter:
 * the rename-always version left a full copy of `dist/` behind on every build, 24 MB a time, and
 * nothing ever cleaned them up.
 *
 * The fallback stays because one passing test is not a guarantee. Whatever held those handles — a
 * sync client, an antivirus scan, a dev server with the file open — can come back, and a build that
 * dies on it is worse than a folder that needs emptying now and then. Old leftovers are swept on
 * the way past, so even when the fallback does fire they stop accumulating.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const outDirs = ['dist'];
const graveyard = '_to_delete';
/** Leftovers older than this are swept; anything newer might belong to a run still going. */
const SWEEP_AFTER_MS = 60 * 60 * 1000;

mkdirSync(graveyard, { recursive: true });

for (const dir of outDirs) {
  if (!existsSync(dir)) continue;
  try {
    rmSync(dir, { recursive: true, force: true });
    console.log(`removed ${dir}`);
  } catch (error) {
    const target = join(graveyard, `${dir}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`);
    renameSync(dir, target);
    console.log(`could not remove ${dir} (${String(error)}); moved it to ${target}`);
  }
}

// Sweep what earlier runs left behind, whichever way they left it.
let swept = 0;
for (const name of existsSync(graveyard) ? readdirSync(graveyard) : []) {
  if (!name.startsWith('dist')) continue;
  const path = join(graveyard, name);
  try {
    if (Date.now() - statSync(path).mtimeMs < SWEEP_AFTER_MS) continue;
    rmSync(path, { recursive: true, force: true });
    swept++;
  } catch {
    // Still held by something. Leave it; the next build will try again.
  }
}
if (swept > 0) console.log(`swept ${swept} old leftover(s) from ${graveyard}/`);
