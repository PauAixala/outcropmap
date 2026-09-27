/**
 * Captures golden values for the disc-vein seeding + placement port
 * (`src/worldgen/tfc-1.20/features/disc-vein.ts`) by compiling and running the *exact,
 * unmodified* method bodies of the real TFC source against a from-scratch (but already
 * fixture-verified elsewhere — see tools/parity/src/XoroshiroFixture.java and
 * tests/fixtures/core/xoroshiro.json's `positionalFactoryFromHashOf`/`nextInt`/`nextIntBound`
 * cases) reimplementation of vanilla's `XoroshiroRandomSource`.
 *
 * Usage: node tools/parity/capture-tfc-veins.mjs <TFC checkout>
 *   node tools/parity/capture-tfc-veins.mjs "$HOME/reference/tfc"
 *
 * Why this does NOT compile `VeinConfig.java`/`DiscVeinConfig.java`/`IVeinConfig.java` themselves,
 * unlike capture-tfc-rocks.mjs's approach for `RockLayerSettings`: those records' `CODEC` static
 * fields need real `com.mojang.serialization` (DataFixerUpper) classes to even class-load, which
 * in turn (going by capture-tfc-rocks.mjs's own comment and capture-minecraft.mjs) come from the
 * official Minecraft *server bundle*'s libraries — not present in this environment (no
 * server.jar/server-mappings.txt anywhere under $HOME, checked before writing this script) and not
 * worth fetching over the network just to satisfy a static initialiser for fields this capture
 * never reads. Extracting method bodies verbatim (the same `method()` slicing technique
 * capture-tfc-rocks.mjs already uses for `Helpers.lerp`) keeps the two things that actually carry
 * placement-correctness risk — `VeinFeature#getVeinsAtChunk`'s seed composition and
 * `VeinFeature#defaultYPos`/`DiscVeinFeature#createVein`/`#defaultPosRespectingHeight`'s position
 * math — 100% real, unmodified TFC 1.20.x source, while the surrounding config/BlockPos/Metaballs2D
 * types are plain hand-written data holders with matching accessor names (no algorithm of their
 * own, so no transcription risk to guard against there). Biome-tag restriction
 * (`IVeinConfig#canSpawnAt`) is deliberately stubbed to always return `true`: it is plain Set
 * membership over `src/data/tfc-1.20/biome-tags.json`, itself extracted directly from the real
 * datapack tag files (no RNG, nothing for a JVM capture to add) — see
 * tools/extract-datapack.mjs's `extractBiomeTags` and docs/WORLDGEN-NOTES.md.
 *
 * If TFC's `VeinFeature.java`/`DiscVeinFeature.java` methods are ever refactored upstream, the
 * `method()` signature lookup below throws (signature not found) rather than silently keeping
 * stale extracted text.
 */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const checkout = resolve(process.argv[2] ?? '');
if (!checkout) throw new Error('Usage: node capture-tfc-veins.mjs <TFC checkout>');
const veinDir = join(checkout, 'src/main/java/net/dries007/tfc/world/feature/vein');

function readSource(name) {
  return readFileSync(join(veinDir, name), 'utf8');
}

/** Same brace-matching method-body slicer as capture-tfc-rocks.mjs/capture-tfc-biomes.mjs. */
function method(source, signature) {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`signature not found: ${signature}`);
  let end = source.indexOf('{', start);
  let depth = 1;
  while (depth && ++end < source.length) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
  }
  if (depth) throw new Error(`unbalanced braces for: ${signature}`);
  return source.slice(start, end + 1);
}

const veinFeatureSrc = readSource('VeinFeature.java');
const discVeinFeatureSrc = readSource('DiscVeinFeature.java');

// Verbatim, unmodified method bodies -- see this file's header for exactly why these three and
// not the whole class.
let getVeinsAtChunk = method(
  veinFeatureSrc,
  'public final void getVeinsAtChunk(WorldGenLevel level, WorldGenerationContext context, int chunkPosX, int chunkPosZ, List<V> veins, C config, Function<BlockPos, Holder<Biome>> biomeQuery)',
);
let defaultYPos = method(veinFeatureSrc, 'protected final int defaultYPos(int verticalShrinkRange, RandomSource random, C config)');
let createVein = method(
  discVeinFeatureSrc,
  'protected Vein createVein(WorldGenerationContext context, int chunkX, int chunkZ, RandomSource random, DiscVeinConfig config)',
);
let defaultPosRespectingHeight = method(
  discVeinFeatureSrc,
  'private BlockPos defaultPosRespectingHeight(int chunkX, int chunkZ, RandomSource random, DiscVeinConfig config)',
);

// The real classes are generic (`VeinFeature<C extends IVeinConfig, V extends IVein>`); this
// harness is monomorphic (one config shape, one vein shape) instead of re-declaring the whole
// class hierarchy just to satisfy generics for a single call site. Substituting the bare type
// parameter tokens `C`/`V` for concrete harness type names changes nothing about the extracted
// logic itself (no `C`/`V` token appears inside an identifier, string or comment in either
// snippet -- verified by the word-boundary regex below only ever matching the type positions).
function monomorphize(text) {
  return text.replace(/\bC\b/g, 'DiscVeinConfigData').replace(/\bV\b/g, 'Vein').replace(/DiscVeinConfig\b/g, 'DiscVeinConfigData');
}
getVeinsAtChunk = monomorphize(getVeinsAtChunk);
defaultYPos = monomorphize(defaultYPos);
createVein = monomorphize(createVein);
defaultPosRespectingHeight = monomorphize(defaultPosRespectingHeight);

// `getVeinsAtChunk` still declares `void`, but the harness wants the outcome back -- wrap it in a
// value-returning method that calls the extracted body unchanged, rather than editing the body.
const harnessSource = `
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.ArrayList;
import java.util.function.Function;
import java.nio.file.Files;
import java.nio.file.Paths;

/**
 * Golden-value harness for the disc-vein seed/placement port. The three methods below marked
 * "REAL TFC SOURCE" are extracted verbatim (see tools/parity/capture-tfc-veins.mjs) from
 * net.dries007.tfc.world.feature.vein.VeinFeature / DiscVeinFeature, TFC 1.20.x. Everything else
 * in this file is hand-written harness scaffolding (plain data holders, a from-scratch xoroshiro128++
 * matching the already fixture-verified src/core/random/xoroshiro.ts, and a no-op Metaballs2D stand-in
 * -- real Metaballs2D output is never read by anything this harness calls, see the header comment
 * in capture-tfc-veins.mjs for why that's safe to skip). Not shipped; source committed under
 * tools/parity/out (gitignored), output written to tests/fixtures/tfc-1.20/veins.json.
 */
public class VeinFixture {
    // ---- xoroshiro128++ + RandomSupport mixing, independently reimplemented from the published
    // algorithm (NOT decompiled Mojang source), identical to tools/parity/src/XoroshiroFixture.java
    // which is itself checked bit-exact against a real captured Minecraft server run
    // (tests/fixtures/core/xoroshiro.json). Reproduced here (rather than shared) only because this
    // harness has no build-system link to that file. ----
    static final long GOLDEN_RATIO_64 = 0x9e3779b97f4a7c15L;
    static final long SILVER_RATIO_64 = 0x6a09e667f3bcc909L;
    static final long MIX13_A = 0xbf58476d1ce4e5b9L;
    static final long MIX13_B = 0x94d049bb133111ebL;

    static long mixStafford13(long seed) {
        seed = (seed ^ (seed >>> 30)) * MIX13_A;
        seed = (seed ^ (seed >>> 27)) * MIX13_B;
        return seed ^ (seed >>> 31);
    }

    /** Stands in for both \`net.minecraft.util.RandomSource\` and
     * \`net.minecraft.world.level.levelgen.XoroshiroRandomSource\` -- the real TFC snippets below
     * only ever call \`nextInt(int)\` on whatever type is named \`RandomSource\` at compile time in
     * this isolated harness. */
    static class RandomSource {
        long lo, hi;
        RandomSource(long seedLo, long seedHi) {
            this.lo = seedLo;
            this.hi = seedHi;
            if ((this.lo | this.hi) == 0) {
                this.lo = GOLDEN_RATIO_64;
                this.hi = SILVER_RATIO_64;
            }
        }
        static RandomSource fromSeed128(long seedLo, long seedHi) { return new RandomSource(seedLo, seedHi); }
        long nextLong() {
            long l0 = lo, l1 = hi;
            long result = Long.rotateLeft(l0 + l1, 17) + l0;
            long newHi = l1 ^ l0;
            long newLo = Long.rotateLeft(l0, 49) ^ newHi ^ (newHi << 21);
            lo = newLo;
            hi = Long.rotateLeft(newHi, 28);
            return result;
        }
        int nextInt() { return (int) nextLong(); }
        int nextInt(int bound) {
            if (bound <= 0) throw new IllegalArgumentException("bound must be positive");
            long threshold = Integer.toUnsignedLong(-bound) % bound;
            long product;
            do {
                product = Integer.toUnsignedLong(nextInt()) * (long) bound;
            } while ((product & 0xffffffffL) < threshold);
            return (int) (product >>> 32);
        }
    }
    // XoroshiroRandomSource is referenced by name in the extracted TFC source below.
    static class XoroshiroRandomSource extends RandomSource {
        XoroshiroRandomSource(long seedLo, long seedHi) { super(seedLo, seedHi); }
    }

    // ---- Plain, logic-free data holders matching the real IVeinConfig/VeinConfig accessor names
    // the extracted methods call (config.config().rarity()/.seed(), config.minY()/.maxY()/.size()).
    // No CODEC, no serialization -- values are set directly from this harness's test cases. ----
    static class VeinConfigData {
        final long seed; final int rarity;
        VeinConfigData(long seed, int rarity) { this.seed = seed; this.rarity = rarity; }
        long seed() { return seed; }
        int rarity() { return rarity; }
    }
    static class DiscVeinConfigData {
        final VeinConfigData configField; final int minY, maxY, size;
        DiscVeinConfigData(VeinConfigData configField, int minY, int maxY, int size) {
            this.configField = configField; this.minY = minY; this.maxY = maxY; this.size = size;
        }
        VeinConfigData config() { return configField; }
        int minY() { return minY; }
        int maxY() { return maxY; }
        int size() { return size; }
        // Real IVeinConfig#canSpawnAt is Set-membership over a biome tag -- no RNG, verified
        // separately (see this file's header comment) -- so it always succeeds here.
        boolean canSpawnAt(BlockPos pos, Function<BlockPos, Holder<Biome>> biomeQuery) { return true; }
    }

    static class BlockPos {
        final int x, y, z;
        BlockPos(int x, int y, int z) { this.x = x; this.y = y; this.z = z; }
        int getX() { return x; }
        int getY() { return y; }
        int getZ() { return z; }
    }
    // Real output never read (see header comment) -- a no-op stand-in is enough for createVein to
    // type-check and run.
    static class Metaballs2D {
        static Metaballs2D simple(RandomSource random, int size) { return new Metaballs2D(); }
    }
    static class Vein {
        final BlockPos posField; final Metaballs2D metaballs;
        Vein(BlockPos pos, Metaballs2D metaballs) { this.posField = pos; this.metaballs = metaballs; }
        BlockPos pos() { return posField; }
    }
    // Stand-ins for types referenced only by the extracted getVeinsAtChunk signature.
    static class WorldGenLevel {
        final long seed;
        WorldGenLevel(long seed) { this.seed = seed; }
        long getSeed() { return seed; }
    }
    static class WorldGenerationContext {}
    static class Holder<T> {}
    static class Biome {}

    // ==== REAL TFC SOURCE (verbatim, see tools/parity/capture-tfc-veins.mjs) ====

    // From VeinFeature#getVeinsAtChunk -- the extracted body itself is untouched; it already
    // mutates the \`veins\` list it is given (\`veins.add(vein)\`), so the harness just reads that
    // list back afterward instead of needing a return value.
    static void getVeinsAtChunk_wrapper(WorldGenLevel level, WorldGenerationContext context, int chunkPosX, int chunkPosZ, List<Vein> veins, DiscVeinConfigData config, Function<BlockPos, Holder<Biome>> biomeQuery)
    ${getVeinsAtChunk.slice(getVeinsAtChunk.indexOf('{'))}

    // From VeinFeature#defaultYPos (verbatim).
    static int defaultYPos${defaultYPos.slice(defaultYPos.indexOf('('))}

    // From DiscVeinFeature#createVein (verbatim).
    static Vein createVein${createVein.slice(createVein.indexOf('('))}

    // From DiscVeinFeature#defaultPosRespectingHeight (verbatim).
    static BlockPos defaultPosRespectingHeight${defaultPosRespectingHeight.slice(defaultPosRespectingHeight.indexOf('('))}

    // ==== End real TFC source ====

    // net.dries007.tfc.world.feature.vein.VeinConfig#hash(String) composed with
    // net.minecraft.world.level.levelgen.RandomSupport#seedFromHashOf(String) -- MD5 of the UTF-8
    // name, first/second 8 bytes read big-endian as the two halves, XORed together. MD5 (not
    // SHA-256) is confirmed correct against a real captured Minecraft server run by this project's
    // existing tests/fixtures/core/xoroshiro.json \`positionalFactoryFromHashOf\` cases and
    // tests/parity/xoroshiro.parity.test.ts (all passing) -- both trivial one-line compositions of
    // an already-verified primitive, safe to write directly rather than extract from Java source
    // that itself needs a live Mojang serialization classpath to even compile.
    static long veinNameSeed(String name) throws Exception {
        MessageDigest md = MessageDigest.getInstance("MD5");
        byte[] digest = md.digest(name.getBytes(StandardCharsets.UTF_8));
        long lo = readLongBE(digest, 0);
        long hi = readLongBE(digest, 8);
        return lo ^ hi;
    }
    static long readLongBE(byte[] b, int off) {
        long v = 0;
        for (int i = 0; i < 8; i++) v = (v << 8) | (b[off + i] & 0xffL);
        return v;
    }

    static String jsonEscape(String s) { return s.replace("\\\\", "\\\\\\\\").replace("\\"", "\\\\\\""); }

    public static void main(String[] args) throws Exception {
        // [worldSeed, randomName, rarity, minY, maxY, size, chunkX, chunkZ]
        Object[][] cases = new Object[][] {
            {0L, "amethyst", 25, 40, 60, 8, 0, 0},
            {0L, "amethyst", 25, 40, 60, 8, 1, 0},
            {0L, "amethyst", 25, 40, 60, 8, 0, 1},
            {42L, "kaolin", 40, 75, 110, 18, 5, -5},
            {42L, "kaolin", 40, 75, 110, 18, -5, 5},
            {-1234567890123L, "gravel", 30, -64, 100, 44, 12345, -6789},
            {-1234567890123L, "gravel", 30, -64, 100, 44, -12345, 6789},
            {123456789L, "sulfur", 4, -64, -45, 18, 100, 100},
            {123456789L, "sulfur", 4, -64, -45, 18, -100, -100},
            {9007199254740993L, "borax", 40, 40, 100, 23, 7, -3},
            {1L, "opal", 25, 40, 60, 8, 0, 0},
            {1L, "opal", 25, 40, 60, 8, 2, -2},
            {0L, "saltpeter", 110, 40, 100, 35, 50, 50},
            {0L, "sylvite", 60, 40, 100, 35, -1, -1},
            {Long.MIN_VALUE, "amethyst", 25, 40, 60, 8, 3, 3},
            {Long.MAX_VALUE, "amethyst", 25, 40, 60, 8, -3, -3},
        };

        StringBuilder out = new StringBuilder();
        out.append("[\\n");
        for (int i = 0; i < cases.length; i++) {
            Object[] c = cases[i];
            long worldSeed = (Long) c[0];
            String randomName = (String) c[1];
            int rarity = (Integer) c[2];
            int minY = (Integer) c[3];
            int maxY = (Integer) c[4];
            int size = (Integer) c[5];
            int chunkX = (Integer) c[6];
            int chunkZ = (Integer) c[7];

            long veinSeed = veinNameSeed(randomName);
            DiscVeinConfigData config = new DiscVeinConfigData(new VeinConfigData(veinSeed, rarity), minY, maxY, size);
            WorldGenLevel level = new WorldGenLevel(worldSeed);
            List<Vein> veins = new ArrayList<>();
            getVeinsAtChunk_wrapper(level, new WorldGenerationContext(), chunkX, chunkZ, veins, config, null);

            boolean spawned = !veins.isEmpty();
            out.append("  {\\n");
            out.append("    \\"worldSeed\\": \\"").append(worldSeed).append("\\",\\n");
            out.append("    \\"randomName\\": \\"").append(jsonEscape(randomName)).append("\\",\\n");
            out.append("    \\"rarity\\": ").append(rarity).append(",\\n");
            out.append("    \\"minY\\": ").append(minY).append(",\\n");
            out.append("    \\"maxY\\": ").append(maxY).append(",\\n");
            out.append("    \\"size\\": ").append(size).append(",\\n");
            out.append("    \\"chunkX\\": ").append(chunkX).append(",\\n");
            out.append("    \\"chunkZ\\": ").append(chunkZ).append(",\\n");
            out.append("    \\"veinNameSeed\\": \\"").append(veinSeed).append("\\",\\n");
            out.append("    \\"spawned\\": ").append(spawned).append(",\\n");
            if (spawned) {
                BlockPos pos = veins.get(0).pos();
                out.append("    \\"x\\": ").append(pos.getX()).append(",\\n");
                out.append("    \\"y\\": ").append(pos.getY()).append(",\\n");
                out.append("    \\"z\\": ").append(pos.getZ()).append("\\n");
            } else {
                out.append("    \\"x\\": null,\\n");
                out.append("    \\"y\\": null,\\n");
                out.append("    \\"z\\": null\\n");
            }
            out.append("  }");
            out.append(i < cases.length - 1 ? ",\\n" : "\\n");
        }
        out.append("]\\n");
        Files.write(Paths.get(args[0]), out.toString().getBytes(StandardCharsets.UTF_8));
        System.out.println("Wrote " + args[0]);
    }
}
`;

const work = mkdtempSync(join(tmpdir(), 'tfc-veins-parity-'));
const javaFile = join(work, 'VeinFixture.java');
writeFileSync(javaFile, harnessSource);

const javaHome = process.env.JAVA_HOME;
const javac = javaHome ? join(javaHome, 'bin', 'javac') : 'javac';
const java = javaHome ? join(javaHome, 'bin', 'java') : 'java';

execFileSync(javac, ['-encoding', 'UTF-8', '-d', work, javaFile], { stdio: 'inherit' });

const fixturesDir = resolve('tests/fixtures/tfc-1.20');
mkdirSync(fixturesDir, { recursive: true });
const outPath = join(fixturesDir, 'veins.json');
execFileSync(java, ['-cp', work, 'VeinFixture', outPath], { stdio: 'inherit' });

const cases = JSON.parse(readFileSync(outPath, 'utf8'));
const fixture = {
  source:
    'net.dries007.tfc.world.feature.vein.VeinFeature#getVeinsAtChunk/#defaultYPos and ' +
    'DiscVeinFeature#createVein/#defaultPosRespectingHeight, TFC 1.20.x, extracted verbatim and run ' +
    'against a from-scratch xoroshiro128++ (see tools/parity/capture-tfc-veins.mjs header). ' +
    'canSpawnAt (biome-tag restriction) is stubbed to always succeed -- verified separately, no RNG.',
  capturedAt: new Date().toISOString(),
  cases,
};
writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n');
console.log(`Fixture written to ${outPath} (${cases.length} cases)`);
