import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The tfg forge catalogue is a view over the game's own `tfc:anvil` recipes, built from a dump of
 * them by `tools/build-anvil-catalogue.mjs`. Before it was, it disagreed with the game: seven rods
 * kept TFC's rules, 16 tiers were wrong, 27 recipes the game does not have, 20 it does have missing.
 * These are the checks that it stays a faithful view, and that it ships only what may be published.
 */
interface Entry {
  id: string;
  recipeId: string;
  input: { item?: string; tag?: string };
  result: { item: string; count?: number };
  tier: number;
  rules: string[];
}
interface Filtered {
  by: string;
  before: number;
  after: number;
  removed: Record<string, number>;
  removedRecipeIds: string[];
}
interface Catalogue {
  _meta: { missingRules?: string[]; counts?: { total: number }; filtered?: Filtered };
  recipes: Record<string, Entry>;
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
const catalogue = readJson<Catalogue>(join(process.cwd(), 'src/data/tfg/anvil-recipes.json'));
const verdicts = readJson<{ keep: string[] }>(join(process.cwd(), 'tools/public-namespaces.json'));
const entries = Object.values(catalogue.recipes);
const namespaceOf = (recipeId: string): string => recipeId.slice(0, recipeId.indexOf(':'));

describe('the tfg forge catalogue', () => {
  it('names each recipe id once', () => {
    const ids = entries.map((e) => e.recipeId);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('carries the rules of every recipe it lists, and leaves none out for want of them', () => {
    // The dump of 2026-09-25 reported "578 of 578 tfc:anvil recipes carry their rules", and the
    // catalogue built from it lists nothing as missing. A rebuild that loses them fails here.
    expect(entries.filter((e) => e.rules.length === 0).map((e) => e.recipeId)).toEqual([]);
    expect(catalogue._meta.missingRules ?? []).toEqual([]);
  });

  it("gives the red steel rod TerraFirmaGreg's draw_last, which the game uses", () => {
    const rod = entries.find((e) => e.recipeId === 'tfc:anvil/red_steel_rod');
    expect(rod?.rules).toEqual(['draw_last']);
    expect(rod?.result).toEqual({ item: 'gtceu:red_steel_rod', count: 2 });
  });

  it('holds only recipes whose namespace tools/public-namespaces.json keeps', () => {
    const keep = new Set(verdicts.keep);
    expect(entries.filter((e) => !keep.has(namespaceOf(e.recipeId))).map((e) => e.recipeId)).toEqual([]);
  });

  it('records in _meta what the filter left out, and counts what it kept', () => {
    const filtered = catalogue._meta.filtered;
    expect(filtered?.by).toBe('tools/build-anvil-catalogue.mjs --keep-namespaces tools/public-namespaces.json');
    expect(filtered?.after).toBe(entries.length);
    expect(catalogue._meta.counts?.total).toBe(entries.length);
    expect((filtered?.before ?? 0) - (filtered?.after ?? 0)).toBe(filtered?.removedRecipeIds.length);
    expect(filtered?.removedRecipeIds.every((id) => !verdicts.keep.includes(namespaceOf(id)))).toBe(true);
    expect(entries.some((e) => filtered?.removedRecipeIds.includes(e.recipeId))).toBe(false);
  });
});

describe('building the catalogue', () => {
  const dir = mkdtempSync(join(tmpdir(), 'outcrop-anvil-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const tool = (args: string[]) => {
    const out = join(dir, 'anvil-recipes.json');
    rmSync(out, { force: true });
    const result = spawnSync(
      process.execPath,
      ['tools/build-anvil-catalogue.mjs', '--profile', 'tfg', ...args, '--out', out, '--previous', join(dir, 'none.json')],
      { encoding: 'utf8' },
    );
    let written: Catalogue | null = null;
    try {
      written = readJson<Catalogue>(out);
    } catch {
      written = null;
    }
    return { status: result.status, log: `${result.stdout}${result.stderr}`, written };
  };
  const fromDump = (recipes: unknown[], extra: string[] = []) => {
    writeFileSync(join(dir, 'outcrop-recipes.json'), JSON.stringify({ recipes }));
    return tool(['--dump', dir, ...extra]);
  };

  const flask = {
    id: 'waterflasks:anvil/red_steel_flask',
    type: 'tfc:anvil',
    json: { input: { item: 'tfc:metal/sheet/red_steel' }, result: { item: 'waterflasks:unfinished_red_steel_flask' }, tier: 6, rules: ['bend_last', 'bend_second_last'] },
  };
  const trapdoor = {
    id: 'createdeco:anvil/brass_trapdoor',
    type: 'tfc:anvil',
    json: { input: { item: 'create:brass_sheet' }, result: { item: 'createdeco:brass_trapdoor' }, tier: 2, rules: ['hit_last'] },
  };

  it('reads rules, tier, input and result as the game holds them', () => {
    const { written } = fromDump([flask]);
    expect(Object.values(written?.recipes ?? {})).toEqual([
      {
        id: 'red_steel_flask',
        recipeId: 'waterflasks:anvil/red_steel_flask',
        input: { item: 'tfc:metal/sheet/red_steel' },
        result: { item: 'waterflasks:unfinished_red_steel_flask' },
        tier: 6,
        rules: ['bend_last', 'bend_second_last'],
      },
    ]);
  });

  it('refuses to write when a recipe in the dump has lost its rules', () => {
    const { status, log, written } = fromDump([
      { id: 'tfc:anvil/copper_rod', type: 'tfc:anvil', json: { input: { item: 'minecraft:copper_ingot' }, result: { item: 'gtceu:copper_rod', count: 2 }, tier: 1 } },
    ]);
    expect(status).not.toBe(0);
    expect(log).toContain('tfc:anvil/copper_rod');
    expect(written).toBeNull();
  });

  it('leaves out, and records, every recipe whose namespace the keep list does not name', () => {
    const keepFile = join(dir, 'keep.json');
    writeFileSync(keepFile, JSON.stringify({ keep: ['waterflasks'] }));
    const { status, written } = fromDump([flask, trapdoor], ['--keep-namespaces', keepFile]);
    expect(status).toBe(0);
    expect(Object.values(written?.recipes ?? {}).map((e) => e.recipeId)).toEqual(['waterflasks:anvil/red_steel_flask']);
    expect(written?._meta.filtered).toMatchObject({
      before: 2,
      after: 1,
      removed: { createdeco: 1 },
      removedRecipeIds: ['createdeco:anvil/brass_trapdoor'],
    });
    expect(written?._meta.counts?.total).toBe(1);
  });

  it('filters an existing catalogue without touching the entries it keeps, and can do it twice', () => {
    const keepFile = join(dir, 'keep.json');
    writeFileSync(keepFile, JSON.stringify({ keep: ['waterflasks'] }));
    const unfiltered = fromDump([flask, trapdoor]).written;
    const source = join(dir, 'unfiltered.json');
    writeFileSync(source, JSON.stringify(unfiltered));
    const once = tool(['--catalogue', source, '--keep-namespaces', keepFile]).written;
    expect(once?.recipes).toEqual({ red_steel_flask: unfiltered?.recipes['red_steel_flask'] });
    expect(once?._meta.filtered?.removedRecipeIds).toEqual(['createdeco:anvil/brass_trapdoor']);

    const again = join(dir, 'once.json');
    writeFileSync(again, JSON.stringify(once));
    const twice = tool(['--catalogue', again, '--keep-namespaces', keepFile]).written;
    expect(twice).toEqual(once);
  });
});
