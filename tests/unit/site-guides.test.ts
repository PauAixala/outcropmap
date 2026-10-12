import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import tfcVeinsJson from '@data/tfc-1.20/veins.json';
import tfgVeinsJson from '@data/tfg/veins.json';
import beneathVeinsJson from '@data/tfg/veins-nether.json';
import moonVeinsJson from '@data/tfg/veins-moon.json';
import marsVeinsJson from '@data/tfg/veins-mars.json';
import venusVeinsJson from '@data/tfg/veins-venus.json';
import tfgKaolinJson from '@data/tfg/kaolin.json';
import tfcAnvilJson from '@data/tfc-1.20/anvil.json';
import tfcRecipesJson from '@data/tfc-1.20/anvil-recipes.json';
import tfgStructuresJson from '@data/tfg/structures.json';
import { siteFacts } from '@app/site/facts';
import {
  WORK_BAR,
  anvilActions,
  guideStructures,
  guideVeins,
  materialIndex,
  rockOnlyVeins,
  tfcRecipeGroups,
  workedExample,
} from '@app/site/guide-data';
import type { VeinSetId } from '@app/site/guide-data';
import { guideTable } from '@app/site/guide-tables';
import { guidePlaceholders } from '@app/site/guides';
import { llmsFullTxt, llmsTxt } from '@app/site/crawl-files';
import { renderSitePage } from '@app/site/pages';
import { GUIDE_IDS, pageUrl, sitePage } from '@app/site/site';
import { TARGET_WORK_MAX, TARGET_WORK_MIN } from '@forge/model/target-work';
import { en } from '@ui/i18n/en';
import { GUIDE_TABLE_IDS, enGuides } from '@ui/i18n/en-guides';

/**
 * The guides (src/app/site/guides.ts): static pages a visitor and a crawler read alike, whose
 * tables come from the same data the map and the forge run on. These tests hold the pages to that
 * data, independently of the code that builds them where they can.
 */
const ROOT = process.cwd();
const read = (file: string): string => readFileSync(join(ROOT, file), 'utf8');
const render = (file: string): string => renderSitePage(file, read(file), { adsEnabled: true });

const unescape = (text: string): string =>
  text.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function visibleText(html: string): string {
  const body = html.slice(html.indexOf('<body'));
  const text = body
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?a\b[^>]*>/g, '')
    .replace(/<[^>]+>/g, ' ');
  return unescape(text).replace(/\s+/g, ' ').trim();
}

const idsOf = (html: string): Set<string> => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));

interface RawVein {
  readonly type: string;
  readonly blocks?: Readonly<Record<string, readonly { readonly block: string }[]>>;
}
const raw = (json: unknown): Readonly<Record<string, RawVein>> => (json as { veins: Record<string, RawVein> }).veins;
const RAW: Readonly<Record<VeinSetId, Readonly<Record<string, RawVein>>>> = {
  tfc: raw(tfcVeinsJson),
  tfg: raw(tfgVeinsJson),
  beneath: raw(beneathVeinsJson),
  moon: raw(moonVeinsJson),
  mars: raw(marsVeinsJson),
  venus: raw(venusVeinsJson),
};
const SETS = Object.keys(RAW) as VeinSetId[];

describe('the guide pages', () => {
  for (const id of ['guides', ...GUIDE_IDS] as const) {
    const page = sitePage(id);

    it(`${page.file} names its page for the shared entry script`, () => {
      expect(read(page.file)).toContain(`data-page="${id}"`);
      expect(read(page.file)).toContain('src="./src/pages/guide/main.ts"');
    });

    it(`${page.file} is a readable article, in the page, with every link pointing somewhere`, () => {
      const html = render(page.file);
      const text = visibleText(html);
      // A guide is reading matter, not a stub: hundreds of words a visitor sees without scripts.
      expect(text.split(' ').length).toBeGreaterThan(id === 'guides' ? 250 : 450);
      const title = id === 'guides' ? enGuides.index.title : enGuides.pages[id].title;
      expect(html).toMatch(new RegExp(`<h1>[^<]*</h1>`));
      expect(text).toContain(guideTitleText(title));
      expect(text).toContain(en.disclaimer);
      // Every in-page link lands on an element of the page.
      const ids = idsOf(html);
      for (const m of html.matchAll(/href="#([^"]+)"/g)) expect([m[1], ids.has(m[1]!)]).toEqual([m[1], true]);
      // No placeholder survives.
      expect(text).not.toMatch(/\{[A-Za-z]+\}/);
    });
  }

  it('links each guide from the guides page, and back', () => {
    const index = render('guides.html');
    for (const id of GUIDE_IDS) {
      expect(index).toContain(`href="./${sitePage(id).file}"`);
      expect(render(sitePage(id).file)).toContain('href="./guides.html"');
    }
  });

  it('resolves every link from one guide to a row of another', () => {
    const ids = new Map<string, Set<string>>();
    const idsIn = (file: string): Set<string> => {
      const known = ids.get(file) ?? idsOf(render(file));
      ids.set(file, known);
      return known;
    };
    for (const id of GUIDE_IDS) {
      const html = render(sitePage(id).file);
      for (const m of html.matchAll(/href="\.\/([a-z-]+\.html)#([^"]+)"/g)) {
        expect([`${m[1]}#${m[2]}`, idsIn(m[1]!).has(m[2]!)]).toEqual([`${m[1]}#${m[2]}`, true]);
      }
    }
  });

  it('shows the anvil section on the forge page itself, linking to the anvil guide', () => {
    const html = render('forge.html');
    const section = /<section id="forge-guide"[^>]*>([\s\S]*?)<\/section>/.exec(html)?.[1] ?? '';
    expect(section).toContain('<h2 id="forge-guide-title">');
    expect(section).toContain('href="./anvil-guide.html"');
    expect(visibleText(`<body>${section}`)).toContain(`${TARGET_WORK_MIN} and ${TARGET_WORK_MAX}`);
  });

  it('lists every guide in llms.txt and puts each one, tables included, in llms-full.txt', () => {
    const llms = llmsTxt({ adsEnabled: true });
    const full = llmsFullTxt({ adsEnabled: true });
    for (const id of GUIDE_IDS) {
      expect(llms).toContain(`](${pageUrl(id)})`);
      expect(full).toContain(`Source: ${pageUrl(id)}`);
    }
    expect(full).toContain('| Vein | Yields |');
  });

  it('builds every table it names, none empty', () => {
    for (const id of GUIDE_TABLE_IDS) {
      const table = guideTable(id);
      expect([id, table.rows.length > 0]).toEqual([id, true]);
      for (const row of table.rows) expect([id, row.cells.length]).toEqual([id, table.columns.length]);
    }
  });
});

describe('the ore vein tables', () => {
  /** A vein places ore if any of its blocks is not plain rock; kaolin is its own feature. */
  const placesOre = (vein: RawVein): boolean =>
    vein.type === 'kaolin_disc' ||
    Object.values(vein.blocks ?? {}).some((list) => list.some((entry) => !entry.block.includes(':rock/')));

  for (const set of SETS) {
    it(`lists every ${set} vein that places ore, and only those`, () => {
      const expected = Object.entries(RAW[set])
        .filter(([, vein]) => placesOre(vein))
        .map(([key]) => key)
        .sort();
      expect(guideVeins(set).map((vein) => vein.key).sort()).toEqual(expected);
      expect(rockOnlyVeins(set)).toEqual(
        Object.keys(RAW[set])
          .filter((key) => !expected.includes(key))
          .sort(),
      );
    });

    it(`splits each ${set} vein's ore between its materials, adding up to the whole`, () => {
      for (const vein of guideVeins(set)) {
        const total = vein.yields.reduce((sum, y) => sum + y.share, 0);
        expect([vein.key, Math.abs(total - 1) < 1e-9]).toEqual([vein.key, true]);
        for (const y of vein.yields) {
          if (y.grades === null) continue;
          const graded = y.grades.poor + y.grades.normal + y.grades.rich;
          expect([vein.key, Math.abs(graded - 1) < 1e-9]).toEqual([vein.key, true]);
        }
      }
    });

    it(`names ${set} materials without the stone they sit in`, () => {
      const stones = ['dripstone', 'pyroxenite', 'deepslate', 'tuff', 'basalt', 'granite', 'diorite', 'gabbro'];
      for (const vein of guideVeins(set)) {
        for (const y of vein.yields) {
          for (const stone of stones) {
            expect([vein.key, y.material, y.material.startsWith(`${stone}_`)]).toEqual([vein.key, y.material, false]);
          }
        }
      }
    });
  }

  it('finds TerraFirmaGreg’s silver in galena, as the map’s ore filter does', () => {
    const silver = materialIndex('tfg').find((material) => material.material === 'silver');
    expect(silver?.sources.some((source) => source.vein.key.includes('galena'))).toBe(true);
  });

  it('keeps TerraFirmaCraft’s grades and deposits apart', () => {
    const copper = guideVeins('tfc').find((vein) => vein.key === 'surface_native_copper');
    const ore = copper?.yields.find((y) => y.material === 'native_copper' && !y.deposit);
    const deposit = copper?.yields.find((y) => y.material === 'native_copper' && y.deposit);
    expect(ore?.grades).not.toBeNull();
    expect(deposit).toBeDefined();
    // No rock ever passes for a material: `tfc:deposit/native_copper/andesite` is native copper.
    expect(copper?.yields.some((y) => y.material === 'andesite')).toBe(false);
  });

  it('measures veins from the surface exactly where the data projects them', () => {
    for (const set of SETS) {
      for (const vein of guideVeins(set)) {
        const source = RAW[set][vein.key] as { project?: boolean } | undefined;
        expect([vein.key, vein.projected]).toEqual([vein.key, source?.project === true]);
      }
    }
  });
});

describe('the kaolin guide', () => {
  it('uses the same numbers as the About page’s answer', () => {
    const facts = siteFacts().kaolin;
    const values = guidePlaceholders();
    const kaolin = guideVeins('tfc').find((vein) => vein.key === 'kaolin_disc');
    expect([kaolin?.minY, kaolin?.maxY]).toEqual([facts.minY, facts.maxY]);
    expect(values['kaolinCentre']).toBe(String(facts.minY + (kaolin?.height ?? 0)));
    expect(values['tfgKaolinBiomeCount']).toBe(String(facts.tfgBiomes.length));
  });

  it('is right that TerraFirmaGreg keeps TerraFirmaCraft’s kaolin feature', () => {
    // The guide says so in words: same size, height and rarity, its own biomes.
    const tfc = (tfcVeinsJson as { veins: { kaolin_disc: Record<string, unknown> } }).veins.kaolin_disc;
    const tfg = (tfgKaolinJson as unknown as { configuredFeature: { config: Record<string, unknown> } }).configuredFeature
      .config;
    for (const key of ['rarity', 'min_y', 'max_y', 'size', 'height']) expect([key, tfg[key]]).toEqual([key, tfc[key]]);
  });
});

describe('the anvil guide', () => {
  it('lists the actions of the data, in the forge’s order', () => {
    const deltas = tfcAnvilJson.actions as Record<string, number>;
    expect(anvilActions().map((action) => [action.key, action.delta])).toEqual(
      ['hit_light', 'hit_medium', 'hit_hard', 'draw', 'punch', 'bend', 'upset', 'shrink'].map((key) => [key, deltas[key]]),
    );
    expect([WORK_BAR.targetMin, WORK_BAR.targetMax]).toEqual([TARGET_WORK_MIN, TARGET_WORK_MAX]);
  });

  it('works an example that really ends on the target with the rules met', () => {
    const example = workedExample();
    const work = example.steps.reduce((sum: number, step) => sum + step.delta, WORK_BAR.start);
    expect(work).toBe(example.target);
    expect(example.steps.at(-1)?.work).toBe(example.target);
    for (const step of example.steps) {
      expect(step.work).toBeGreaterThanOrEqual(WORK_BAR.min);
      expect(step.work).toBeLessThan(WORK_BAR.limit);
    }
    // Checked here without the solver: each rule against the last three strikes.
    const names = example.steps.map((step) => step.label);
    const last3 = names.slice(-3);
    for (const rule of example.rules) {
      const action = en.forge.actionNames[rule.type];
      const at = (i: number): string | undefined => last3[last3.length - 1 - i];
      const ok =
        rule.position === 'LAST'
          ? at(0) === action
          : rule.position === 'SECOND_LAST'
            ? at(1) === action
            : rule.position === 'THIRD_LAST'
              ? at(2) === action
              : rule.position === 'NOT_LAST'
                ? at(1) === action || at(2) === action
                : last3.includes(action);
      expect([rule.type, rule.position, ok]).toEqual([rule.type, rule.position, true]);
    }
  });

  it('puts every TerraFirmaCraft recipe in exactly one item group, one rule set per item', () => {
    const groups = tfcRecipeGroups();
    const recipes = Object.values(tfcRecipesJson.recipes);
    const metals = groups.reduce((sum, group) => sum + Math.max(group.metals.length, 1), 0);
    expect(metals).toBeLessThanOrEqual(recipes.length);
    const kinds = groups.map((group) => group.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});

describe('the structures guide', () => {
  it('lists every structure set the pack places', () => {
    const sets = (tfgStructuresJson as { sets: { id: string; structures: unknown[] }[] }).sets
      .filter((set) => set.structures.length > 0)
      .map((set) => set.id)
      .sort();
    expect(guideStructures().map((structure) => structure.id).sort()).toEqual(sets);
  });
});

/** The heading as the page shows it, placeholders filled. */
function guideTitleText(title: string): string {
  const values = guidePlaceholders();
  return title.replace(/\{([A-Za-z]+)\}/g, (_m, key: string) => values[key] ?? `{${key}}`);
}
