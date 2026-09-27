/** Runs actual TFC 1.20 source with the official Minecraft 1.20.1 RNG/math binary, mirroring
 * capture-tfc-biomes.mjs -- see that file's header for the general approach.
 * Usage: node tools/parity/capture-tfc-rocks.mjs <TFC checkout> <MC extracted server dir>
 *
 * Captures two things, both real, unmodified TFC source:
 *  - `TFCLayers.createOverworldRockLayer`'s block-scale zoom of `Region.Point.rock`
 *    (`RegionGenerator.rockAt`, `src/worldgen/tfc-1.20/rock/layer.ts`), using the exact same
 *    `RegionChunkDataGenerator.create` seed-derivation sequence this port reproduces.
 *  - `RockLayerSettings.sampleAtLayer(pointRock, layerN)` for each of those same captured
 *    `pointRock` values at several depths (`src/worldgen/tfc-1.20/rock/layer-settings.ts`) --
 *    the real rock-tree-traversal algorithm, not a reimplementation.
 *
 * `RockLayerSettings.Data` (the datapack-defined rock tree) is built directly via its own
 * constructor from `src/data/tfc-1.20/rocks.json`'s already-extracted `rockLayers` field --
 * bypassing `Data.CODEC`'s JSON decoding entirely, the same way capture-tfc-biomes.mjs bypasses
 * `Settings`' codec -- so the fixture and this port are guaranteed to start from byte-identical
 * tree data. `RockSettings` (a record of ~9 `Block` fields plus block-state helpers TFC uses for
 * world*generation* concerns this project doesn't touch) is shimmed down to just an `id` string
 * and distinct placeholder `Block` objects (for the real `RockLayerSettings` constructor's
 * identity-keyed maps, never otherwise read here) -- see this file's `RockSettings.java`/`Block.java`
 * shims below. `RockLayerSettings.java` itself is copied and compiled unmodified.
 */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { resolve, join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const checkout = resolve(process.argv[2]);
const mc = resolve(process.argv[3]);
const root = join(checkout, 'src/main/java/net/dries007/tfc');
const work = mkdtempSync(join(tmpdir(), 'tfc-rocks-parity-'));
const files = [];
function source(p) { return readFileSync(join(root, p), 'utf8'); }
function put(p, s) { const f = join(work, p); mkdirSync(resolve(f, '..'), { recursive: true }); writeFileSync(f, s); files.push(f); }
function copy(p) { put('net/dries007/tfc/' + p, source(p)); }
function method(s, signature) { const start = s.indexOf(signature); if (start < 0) throw Error(signature); let end = s.indexOf('{', start), depth = 1; while (depth && ++end < s.length) { if (s[end] === '{') depth++; if (s[end] === '}') depth--; } if (depth) throw Error(signature); return s.slice(start, end + 1); }
function walk(p) { return readdirSync(p, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(p, e.name)) : [join(p, e.name)])); }

for (const p of ['world/region', 'world/layer/framework']) {
  for (const name of readdirSync(join(root, p))) {
    if (name.endsWith('.java') && name !== 'package-info.java') copy(p + '/' + name);
  }
}
for (const name of ['MoreShoresLayer', 'RegionBiomeLayer', 'RegionEdgeBiomeLayer', 'RegionLayer', 'RegionRockLayer', 'ShoreLayer', 'SmoothLayer', 'UniformLayer', 'ZoomLayer']) {
  copy('world/layer/' + name + '.java');
}
for (const name of ['FastNoiseLite', 'Noise2D', 'OpenSimplex2D', 'Cellular2D']) copy('world/noise/' + name + '.java');
for (const name of ['River', 'RiverHelpers', 'MidpointFractal']) copy('world/river/' + name + '.java');
copy('world/FastConcurrentCache.java');
copy('world/settings/RockLayerSettings.java');
put('net/dries007/tfc/world/river/Flow.java', 'package net.dries007.tfc.world.river; public class Flow {public static Flow fromAngle(double a){throw new UnsupportedOperationException("Flow is not sampled");}}');
for (const name of ['Nullable', 'TestOnly', 'VisibleForTesting']) put('org/jetbrains/annotations/' + name + '.java', `package org.jetbrains.annotations; public @interface ${name} {}`);
put('net/dries007/tfc/world/settings/Settings.java', `package net.dries007.tfc.world.settings; public record Settings(int temperatureScale,float temperatureConstant,int rainfallScale,float rainfallConstant,float continentalness){}`);
put('net/minecraft/world/level/ChunkPos.java', 'package net.minecraft.world.level; public class ChunkPos {public static long asLong(int x,int z){return (x&0xffffffffL)|((z&0xffffffffL)<<32);}}');
// `RockLayerSettings.java` imports these two but never uses them (leftover from a wider settings
// API this port doesn't touch) -- trivial empty stand-ins, just so the import resolves.
put('net/minecraft/core/BlockPos.java', 'package net.minecraft.core; public class BlockPos {}');
put('net/minecraft/resources/ResourceLocation.java', 'package net.minecraft.resources; public class ResourceLocation {}');
const helpers = source('util/Helpers.java');
put('net/dries007/tfc/util/Helpers.java', `package net.dries007.tfc.util;public class Helpers {${method(helpers, 'public static double lerp(')}}`);

// `RockLayerSettings.java` needs `Block` only as an identity-map key type (see this file's header)
// -- never a real block. A same-named source file in this compilation wins over the real compiled
// class already on the classpath (verified: javac has no trouble with this, no "duplicate class").
put('net/minecraft/world/level/block/Block.java', 'package net.minecraft.world.level.block; public class Block {}');
// `RockLayerSettings.Data.CODEC`'s static initializer references `RockSettings.CODEC` and
// `Codecs.orderPreservingUnboundedMapCodec` even though this harness never decodes anything with
// them (it builds `Data` directly, see below) -- both must still exist and not throw at class-load.
put('net/dries007/tfc/world/Codecs.java', `package net.dries007.tfc.world;import com.mojang.serialization.Codec;import java.util.Map;
public class Codecs { public static <K,V> Codec<Map<K,V>> orderPreservingUnboundedMapCodec(Codec<K> key,Codec<V> value){return Codec.unboundedMap(key,value);} }`);
put('net/dries007/tfc/world/settings/RockSettings.java', `package net.dries007.tfc.world.settings;import java.util.Map;import java.util.HashMap;import java.util.Optional;import com.mojang.serialization.Codec;import net.minecraft.world.level.block.Block;
public record RockSettings(String id,Block raw,Block hardened,Block gravel,Block cobble,Block sand,Block sandstone,Optional<Block> spike,Optional<Block> loose,Optional<Block> mossyLoose) {
 private static final Map<String,RockSettings> INSTANCES=new HashMap<>();
 public static final Codec<RockSettings> CODEC=Codec.STRING.xmap(RockSettings::of,RockSettings::id);
 public static synchronized RockSettings of(String id){return INSTANCES.computeIfAbsent(id,k->new RockSettings(k,new Block(),new Block(),new Block(),new Block(),new Block(),new Block(),Optional.empty(),Optional.empty(),Optional.empty()));}
}`);

const tfc = source('world/layer/TFCLayers.java');
const ids = [...tfc.matchAll(/([A-Z_]+) = register\(\(\) -> TFCBiomes\.([A-Z_]+)\);/g)].map((m) => m[1]);
put(
  'net/dries007/tfc/world/layer/TFCLayers.java',
  `package net.dries007.tfc.world.layer;import java.util.Random;import net.minecraft.util.RandomSource;import net.dries007.tfc.world.layer.framework.*;import net.dries007.tfc.world.region.*;
public class TFCLayers {${ids.map((n, i) => `public static final int ${n}=${i};`).join('\n')}
${['public static AreaFactory createOverworldRockLayer(', 'public static AreaFactory createUniformLayer(', 'public static boolean hasShore(', 'public static int shoreFor(', 'public static boolean hasLake(', 'public static int lakeFor(', 'public static boolean isOcean(', 'public static boolean isMountains(', 'public static boolean isLow('].map((s) => method(tfc, s)).join('\n')}}`,
);

// Same reflection bridge as capture-tfc-biomes.mjs -- calls the original obfuscated Minecraft
// classes, selected using the official mappings, rather than reimplementing their RNG.
const mappings = readFileSync(join(mc, 'server-mappings.txt'), 'utf8');
function mappedClass(name) { const m = mappings.match(new RegExp('^' + name.replaceAll('.', '\\.') + ' -> ([^:]+):', 'm')); if (!m) throw Error(name); return m[1]; }
function mappedMethod(owner, signature) { const block = mappings.split(owner + ' -> ')[1]?.split('\n').slice(1).join('\n').split(/\n\S/)[0]; const row = block?.split('\n').find((l) => l.includes(signature + ' -> ')); if (!row) throw Error(signature); return row.split(' -> ')[1].trim(); }
put('fixture/Minecraft.java', `package fixture;import java.lang.reflect.*;import java.util.*;public class Minecraft {
 static final Map<String,Method> methods=new HashMap<>();
 public static Object construct(String cls,long seed){try{return Class.forName(cls).getConstructor(long.class).newInstance(seed);}catch(Exception e){throw new RuntimeException(e);}}
 public static Object call(String cls,String name,Object target,Class<?>[] types,Object...args){try{String key=cls+name+Arrays.toString(types);Method m=methods.get(key);if(m==null){m=Class.forName(cls).getMethod(name,types);methods.put(key,m);}return m.invoke(target,args);}catch(Exception e){throw new RuntimeException(e);}}
}`);
const rngOwner = 'net.minecraft.world.level.levelgen.XoroshiroRandomSource';
const rngMethods = [['void', 'setSeed', 'long', 'seed'], ['int', 'nextInt', '', ''], ['int', 'nextInt', 'int', 'bound'], ['long', 'nextLong', '', ''], ['boolean', 'nextBoolean', '', ''], ['float', 'nextFloat', '', ''], ['double', 'nextDouble', '', '']];
put('net/minecraft/util/RandomSource.java', `package net.minecraft.util;public interface RandomSource {${rngMethods.map(([r, n, t, a]) => `${r} ${n}(${t} ${a});`).join('\n')}}`);
put('net/minecraft/world/level/levelgen/XoroshiroRandomSource.java', `package net.minecraft.world.level.levelgen;import fixture.Minecraft;import net.minecraft.util.RandomSource;public class XoroshiroRandomSource implements RandomSource {
 private final Object rng;public XoroshiroRandomSource(long seed){rng=Minecraft.construct("${mappedClass(rngOwner)}",seed);}
 ${rngMethods.map(([r, n, t, a]) => `public ${r} ${n}(${t} ${a}){${r === 'void' ? '' : `return (${r})`}Minecraft.call("${mappedClass(rngOwner)}","${mappedMethod(rngOwner, r + ' ' + n + '(' + t + ')')}",rng,new Class<?>[]{${t ? t + '.class' : ''}}${a ? ',' + a : ''});}`).join('\n')}
}`);

const mthOwner = 'net.minecraft.util.Mth';
const mthMethods = [['int', 'floor', 'double'], ['int', 'ceil', 'float'], ['double', 'clamp', 'double,double,double'], ['float', 'lerp', 'float,float,float'], ['float', 'clampedMap', 'float,float,float,float,float'], ['int', 'smallestEncompassingPowerOfTwo', 'int'], ['float', 'sin', 'float'], ['float', 'cos', 'float'], ['double', 'atan2', 'double,double']];
put('net/minecraft/util/Mth.java', `package net.minecraft.util;import fixture.Minecraft;public class Mth {${mthMethods.map(([r, n, ts]) => { const t = ts.split(','); return `public static ${r} ${n}(${t.map((v, i) => v + ' a' + i).join(',')}){return (${r})Minecraft.call("${mappedClass(mthOwner)}","${mappedMethod(mthOwner, r + ' ' + n + '(' + ts + ')')}",null,new Class<?>[]{${t.map((v) => v + '.class').join(',')}},${t.map((_, i) => 'a' + i).join(',')});}`; }).join('\n')}}`);

// The rock-tree data itself, byte-identical to what src/worldgen/tfc-1.20/rock/layer-settings.ts
// builds its tree from (both read src/data/tfc-1.20/rocks.json's `rockLayers` field) -- see this
// file's header.
const rocksJsonPath = new URL('../../src/data/tfc-1.20/rocks.json', import.meta.url);
const rocksData = JSON.parse(readFileSync(rocksJsonPath, 'utf8'));
const rl = rocksData.rockLayers;
const rockIds = Object.keys(rocksData.rocks);
function javaStringList(ids) { return `java.util.List.of(${ids.map((s) => JSON.stringify(s)).join(',')})`; }
function javaOrderedMap(entries) {
  const puts = entries.map(([k, v]) => `m.put(${JSON.stringify(k)},${JSON.stringify(v)});`).join('');
  return `new java.util.function.Supplier<java.util.Map<String,String>>(){public java.util.Map<String,String> get(){java.util.LinkedHashMap<String,String> m=new java.util.LinkedHashMap<>();${puts}return m;}}.get()`;
}
const rocksMapLiteral = `new java.util.function.Supplier<java.util.Map<String,RockSettings>>(){public java.util.Map<String,RockSettings> get(){java.util.HashMap<String,RockSettings> m=new java.util.HashMap<>();${rockIds
  .map((id) => `m.put(${JSON.stringify(id)},RockSettings.of(${JSON.stringify(id)}));`)
  .join('')}return m;}}.get()`;
const layersLiteral = `java.util.List.of(\n      ${rl.layers.map((l) => `new RockLayerSettings.LayerData(${JSON.stringify(l.id)},${javaOrderedMap(l.entries)})`).join(',\n      ')})`;

put(
  'fixture/CaptureRocks.java',
  `package fixture;import java.util.*;import java.nio.file.*;import net.minecraft.world.level.levelgen.XoroshiroRandomSource;import net.dries007.tfc.world.region.*;import net.dries007.tfc.world.settings.*;import net.dries007.tfc.world.layer.*;import net.dries007.tfc.world.layer.framework.*;
public class CaptureRocks {
 public static void main(String[] args) throws Exception {
  Locale.setDefault(Locale.ROOT);
  RockLayerSettings.Data data = new RockLayerSettings.Data(
    ${rocksMapLiteral},
    ${javaStringList(rl.bottom)},
    ${layersLiteral},
    ${javaStringList(rl.oceanFloor)},
    ${javaStringList(rl.land)},
    ${javaStringList(rl.volcanic)},
    ${javaStringList(rl.uplift)}
  );
  RockLayerSettings settings = data.parse();
  StringJoiner cases = new StringJoiner(",");
  for (long seed : new long[]{0,42,-123456789}) {
   XoroshiroRandomSource random = new XoroshiroRandomSource(seed);
   RegionGenerator g = new RegionGenerator(new Settings(20000,0,20000,0,.5f), random);
   long chunkDataSeed = random.nextLong();
   random.nextLong(); // biomeLayerSeed -- drawn here only to match TFCChunkGenerator.initRandomState's real order, unused otherwise
   XoroshiroRandomSource chunkRandom = new XoroshiroRandomSource(chunkDataSeed);
   chunkRandom.setSeed(chunkDataSeed ^ chunkRandom.nextLong());
   long rockLayerSeed = chunkRandom.nextLong();
   Area rockLayerArea = TFCLayers.createOverworldRockLayer(g, rockLayerSeed).get();
   StringJoiner blocks = new StringJoiner(","), samples = new StringJoiner(",");
   for (int x = -3000; x <= 3000; x += 137) for (int z = -3000; z <= 3000; z += 251) {
    int pointRock = rockLayerArea.get(x, z);
    blocks.add(String.format("[%d,%d,%d]", x, z, pointRock));
    for (int layerN = 0; layerN <= 4; layerN++) {
     RockSettings r = settings.sampleAtLayer(pointRock, layerN);
     samples.add(String.format("{\\"pointRock\\":%d,\\"layerN\\":%d,\\"id\\":\\"%s\\"}", pointRock, layerN, r.id()));
    }
   }
   cases.add(String.format("{\\"seed\\":\\"%d\\",\\"rockLayerSeed\\":\\"%d\\",\\"blocks\\":[%s],\\"samples\\":[%s]}", seed, rockLayerSeed, blocks, samples));
   System.err.println("Captured seed " + seed);
  }
  Files.writeString(Path.of(args[0]), "["+cases+"]");
 }
}`,
);

const jars = walk(join(mc, 'META-INF')).filter((p) => p.endsWith('.jar'));
const classpath = [work, ...jars].join(delimiter);
execFileSync('javac', ['-cp', classpath, '-d', work, ...files], { stdio: 'inherit' });
const output = join(work, 'rocks.json');
execFileSync('java', ['-Xmx2g', '-cp', classpath, 'fixture.CaptureRocks', output], { stdio: 'inherit', timeout: 600000 });
const revision = execFileSync('git', ['-c', `safe.directory=${checkout.replaceAll('\\', '/')}`, '-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const fixture = {
  source: 'Unmodified TFC RegionGenerator full task pipeline, TFCLayers.createOverworldRockLayer and RockLayerSettings.sampleAtLayer, original layer/river/noise/region classes; actual official Minecraft 1.20.1 XoroshiroRandomSource through mapped reflection. RockSettings is shimmed to an id string plus distinct placeholder Block identity objects (never otherwise read here); RockLayerSettings.Data is built directly from src/data/tfc-1.20/rocks.json\'s already-extracted rockLayers field, bypassing its Codec/JSON-decoding path entirely. A source execution fixture, not generated-world observations.',
  revision,
  capturedAt: new Date().toISOString(),
  cases: JSON.parse(readFileSync(output, 'utf8')),
};
mkdirSync('tests/fixtures/tfc-1.20', { recursive: true });
writeFileSync('tests/fixtures/tfc-1.20/rocks.json', JSON.stringify(fixture, null, 2) + '\n');
console.log(`Captured ${fixture.cases.length} seeds; temporary source: ${work}`);
