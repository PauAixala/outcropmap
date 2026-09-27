/**
 * Paths that are safe to write into committed files.
 *
 * Every extractor records where its data came from in a `_meta` block, and the first versions wrote
 * the absolute path on whoever ran them: `C:/Users/<name>/reference/tfc`, a CurseForge instance on a
 * second drive, even a cloud container's `/sessions/...`. That names a person's machine in a file
 * that ships, and tells a stranger nothing they can use. `portableSource` rewrites a local path into
 * the most useful form that does not depend on the machine, in this order:
 *
 *   1. inside this repository         -> the repo-relative path, `tools/.cache/...`
 *   2. inside a git checkout with a   -> the upstream URL (credentials stripped, `.git` dropped),
 *      network remote                    followed by the path inside the checkout, if any
 *   3. inside a modpack instance      -> `<instance>/kubejs/...` (a folder with `mods/` and `kubejs/`)
 *   4. under the home directory       -> `$HOME/reference/tfc`
 *   5. anywhere else                  -> `<local>/<file name>`
 *
 * The commit a file was generated from is recorded separately (`git_commit`, `tfcCommit`, ...), so
 * a URL plus that commit is enough to fetch exactly what was read.
 *
 * `resolveInstance` is the other half: no tool defaults to one person's instance folder any more.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const posix = (p) => p.split(path.sep).join('/').replaceAll('\\', '/');

/** `child` relative to `parent`, or `null` when it is not inside it (including across drives). */
function inside(parent, child) {
  const rel = path.relative(parent, child);
  if (rel === '') return '';
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return posix(rel);
}

function git(dir, args) {
  try {
    // `safe.directory` per command: reference checkouts are often owned by another user on Windows,
    // and this must never touch the global git config.
    return execFileSync('git', ['-c', 'safe.directory=*', '-C', dir, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

/**
 * A remote URL fit to publish, or `null` when the remote is a local path.
 * `https://user:token@host/a/b.git` -> `https://host/a/b`; `git@host:a/b.git` -> `https://host/a/b`.
 */
export function publicRemote(remote) {
  if (typeof remote !== 'string' || remote === '') return null;
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(remote);
  let url = scp ? `https://${scp[1]}/${scp[2]}` : remote;
  if (!/^(https?|ssh|git):\/\//i.test(url)) return null;
  try {
    const parsed = new URL(url.replace(/^(ssh|git):\/\//i, 'https://'));
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    url = parsed.toString();
  } catch {
    return null;
  }
  return url.replace(/\/$/, '').replace(/\.git$/, '');
}

/** The nearest ancestor (or self) holding both `mods/` and `kubejs/`, i.e. a modpack instance. */
function instanceRoot(abs) {
  let dir = fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'mods')) && fs.existsSync(path.join(dir, 'kubejs'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** See the header. `home` is injectable for tests. */
export function portableSource(target, { home = os.homedir(), projectRoot = PROJECT_ROOT } = {}) {
  const abs = path.resolve(target);

  const inProject = inside(projectRoot, abs);
  if (inProject !== null) return inProject === '' ? '.' : inProject;

  const top = git(fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? abs : path.dirname(abs), [
    'rev-parse',
    '--show-toplevel',
  ]);
  if (top) {
    const url = publicRemote(git(top, ['remote', 'get-url', 'origin']));
    const rel = inside(path.resolve(top), abs);
    if (url && rel !== null) return rel === '' ? url : `${url}/${rel}`;
  }

  const instance = instanceRoot(abs);
  if (instance) {
    const rel = inside(instance, abs);
    return rel ? `<instance>/${rel}` : '<instance>';
  }

  const inHome = inside(path.resolve(home), abs);
  if (inHome !== null) return inHome === '' ? '$HOME' : `$HOME/${inHome}`;

  return `<local>/${path.basename(abs)}`;
}

/**
 * The modpack instance to read: `--instance`, else `$OUTCROP_INSTANCE`, else a clear exit.
 * There is deliberately no default — the last one was a path on one person's second drive.
 */
export function resolveInstance(value, { tool = 'this tool' } = {}) {
  const instance = value ?? process.env.OUTCROP_INSTANCE;
  if (!instance) {
    console.error(
      `${tool}: no modpack instance given. Pass --instance "<folder containing mods/ and kubejs/>" ` +
        'or set OUTCROP_INSTANCE.',
    );
    process.exit(1);
  }
  return instance;
}

/**
 * The vanilla 1.20.1 client jar: `--jar`, else `$OUTCROP_MC_JAR`, else a clear exit. Launchers keep
 * it in different places (`versions/1.20.1/1.20.1.jar` under the launcher's install folder).
 */
export function resolveVanillaJar(value, { tool = 'this tool' } = {}) {
  const jar = value ?? process.env.OUTCROP_MC_JAR;
  if (!jar) {
    console.error(
      `${tool}: no vanilla jar given. Pass --jar "<launcher>/versions/1.20.1/1.20.1.jar" or set OUTCROP_MC_JAR.`,
    );
    process.exit(1);
  }
  return jar;
}
