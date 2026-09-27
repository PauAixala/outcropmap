// Usage: node tools/parity/capture-minecraft.mjs <external directory containing server.jar>
// The input is Mojang's official 1.20.1 server bundle. Nothing from it is redistributed.
import { readdirSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, delimiter } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

if (!process.argv[2]) throw new Error('Pass the external Minecraft 1.20.1 reference directory');
const reference = resolve(process.argv[2]);
const out = join(reference, 'fixture-classes');
mkdirSync(out, { recursive: true });
execFileSync('jar', ['xf', 'server.jar', 'META-INF/versions', 'META-INF/libraries'], { cwd: reference });
function jars(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? jars(join(dir, e.name)) : e.name.endsWith('.jar') ? [join(dir, e.name)] : []);
}
const classpath = [out, ...jars(join(reference, 'META-INF'))].join(delimiter);
execFileSync('javac', ['-encoding', 'UTF-8', '-cp', classpath, '-d', out,
  'tools/parity/src/MinecraftRandomFixture.java'], { stdio: 'inherit' });
const fixturePath = resolve('tests/fixtures/core/xoroshiro.json');
execFileSync('java', ['-cp', classpath, 'fixture.MinecraftRandomFixture', fixturePath], { stdio: 'inherit' });
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
fixture.serverBundleSha1 = createHash('sha1').update(readFileSync(join(reference, 'server.jar'))).digest('hex');
writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + '\n');
