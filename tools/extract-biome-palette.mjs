/** Extract numeric map colours from a local TFC 1.20 checkout; no Java source/assets are copied.
 * Usage: node tools/extract-biome-palette.mjs <tfc-checkout>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const reference = process.argv[2];
if (!reference) throw new Error('Pass the path to a TFC 1.20 source checkout');
const sourceFile = 'src/test/java/net/dries007/tfc/drawing/RegionGeneratorTest.java';
const source = readFileSync(join(reference, sourceFile), 'utf8');
const method = source.split('private Color biomeColor(int biome)')[1]?.split('private RegionGenerator')[0];
if (!method) throw new Error('RegionGeneratorTest.biomeColor was not found');
const colors = {};
for (const match of method.matchAll(/if \(([^\n]+)\) return new Color\((\d+), (\d+), (\d+)\);/g)) {
  const color = (Number(match[2]) << 16) | (Number(match[3]) << 8) | Number(match[4]);
  for (const name of match[1].matchAll(/biome == ([A-Z_]+)/g)) colors[`tfc:${name[1].toLowerCase()}`] = color;
}
if (Object.keys(colors).length !== 27) throw new Error('Upstream palette changed; review the extractor');
// The upstream debug palette leaves these three as black. Use the closest named category so
// they remain visible in either theme, and retain the aliases in the generated provenance.
const viewerAliases = {
  'tfc:salt_marsh': 'tfc:lowlands',
  'tfc:tidal_flats': 'tfc:shore',
  'tfc:volcanic_oceanic_mountain_lake': 'tfc:oceanic_mountain_lake',
};
for (const [id, sourceId] of Object.entries(viewerAliases)) colors[id] = colors[sourceId];
const output = {
  source: `${sourceFile}#biomeColor (TFC 1.20.x)`,
  viewerAliases,
  colors,
};
mkdirSync('src/data/tfc-1.20', { recursive: true });
writeFileSync('src/data/tfc-1.20/biome-palette.json', `${JSON.stringify(output, null, 2)}\n`);
