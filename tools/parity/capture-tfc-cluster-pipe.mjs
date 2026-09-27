/**
 * Captures golden values for the cluster and pipe vein **placement** ports
 * (`src/worldgen/tfc-1.20/features/cluster-vein.ts`, `pipe-vein.ts`).
 *
 * Usage: node tools/parity/capture-tfc-cluster-pipe.mjs <TFC checkout>
 *   node tools/parity/capture-tfc-cluster-pipe.mjs "$HOME/reference/tfc"
 *
 * A sibling of capture-tfc-veins.mjs rather than an extension of it: that script is monomorphised
 * around `DiscVeinConfig` and is already the verified capture for the disc path, so bending it to
 * three config shapes would put a working fixture at risk for no gain.
 *
 * Scope. The chunk RNG seed composition (`VeinFeature#getVeinsAtChunk`) is already verified by
 * capture-tfc-veins.mjs and is shared by all three vein shapes, so these cases start from the
 * resulting `(lo, hi)` state and verify what is built on top of it: the rarity roll, then
 * `createVein`. That is exactly the code cluster-vein.ts and pipe-vein.ts add.
 *
 * The specific thing worth capturing for pipes: **the draw order is not the argument order.**
 *
 * ```java
 * final float angle = random.nextFloat() * (float) Math.PI * 2;
 * return new Vein(defaultPos(chunkX, chunkZ, random, config),
 *                 config.sign() < random.nextFloat() ? 1 : -1,
 *                 Mth.cos(angle), Mth.sin(angle),
 *                 Helpers.uniform(random, config.minSkew(), 1 + config.maxSkew()),
 *                 Helpers.uniform(random, config.minSlant(), 1 + config.maxSlant()));
 * ```
 *
 * `angle` is drawn on the line *before* the constructor call, so reading the arguments left to
 * right would place that `nextFloat()` after the position and shift every later value — while still
 * producing perfectly plausible coordinates. `skew` is captured too because the port reports
 * `radius + skew` as the vein's width.
 *
 * As in the other captures, the method bodies below are **verbatim, unmodified** TFC 1.20.x source
 * sliced out by brace matching; an upstream refactor throws rather than silently going stale.
 */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const checkout = resolve(process.argv[2] ?? '');
if (!checkout) throw new Error('Usage: node capture-tfc-cluster-pipe.mjs <TFC checkout>');
const veinDir = join(checkout, 'src/main/java/net/dries007/tfc/world/feature/vein');
const noiseDir = join(checkout, 'src/main/java/net/dries007/tfc/world/noise');
const utilDir = join(checkout, 'src/main/java/net/dries007/tfc/util');

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

const veinFeatureSrc = readFileSync(join(veinDir, 'VeinFeature.java'), 'utf8');
const clusterSrc = readFileSync(join(veinDir, 'ClusterVeinFeature.java'), 'utf8');
const pipeSrc = readFileSync(join(veinDir, 'PipeVeinFeature.java'), 'utf8');
const balls3dSrc = readFileSync(join(noiseDir, 'Metaballs3D.java'), 'utf8');
const helpersSrc = readFileSync(join(utilDir, 'Helpers.java'), 'utf8');

// --- verbatim TFC source ---
const defaultPos = method(
  veinFeatureSrc,
  'protected final BlockPos defaultPos(int chunkX, int chunkZ, RandomSource random, C config)',
);
const defaultYPos = method(
  veinFeatureSrc,
  'protected final int defaultYPos(int verticalShrinkRange, RandomSource random, C config)',
);
const clusterCreate = method(
  clusterSrc,
  'protected Vein createVein(WorldGenerationContext context, int chunkX, int chunkZ, RandomSource random, ClusterVeinConfig config)',
);
const pipeCreate = method(
  pipeSrc,
  'protected Vein createVein(WorldGenerationContext context, int chunkX, int chunkZ, RandomSource random, PipeVeinConfig config)',
);
const simple3d = method(balls3dSrc, 'public static Metaballs3D simple(RandomSource random, int size)');
const ctor3d = method(
  balls3dSrc,
  'public Metaballs3D(RandomSource random, int minBalls, int maxBalls, double minSize, double maxSize, double radius)',
);
const uniformInt = method(helpersSrc, 'public static int uniform(RandomSource random, int min, int max)');
const uniformDouble = method(helpersSrc, 'public static double uniform(RandomSource random, double min, double max)');
const triangleDouble = method(helpersSrc, 'public static double triangle(RandomSource random, double delta)');

// The real classes are generic; this harness is monomorphic per shape. Substituting the bare type
// parameter token `C` for the concrete config name changes nothing about the extracted logic --
// `C` never appears inside an identifier, string or comment in these snippets.
// The extracted `createVein` signatures name the real config classes; the harness holders are
// named differently, so substitute those type tokens the same way `C` is substituted below.
const clusterCreateMono = clusterCreate.split('ClusterVeinConfig').join('ClusterConfig');
const pipeCreateMono = pipeCreate.split('PipeVeinConfig').join('PipeConfig');
const clusterPos = defaultPos.replace(/\bC\b/g, 'ClusterConfig');
const clusterYPos = defaultYPos.replace(/\bC\b/g, 'ClusterConfig');
const pipePos = defaultPos.replace(/\bC\b/g, 'PipeConfig');
const pipeYPos = defaultYPos.replace(/\bC\b/g, 'PipeConfig');

const harness = `
import java.nio.file.Files;
import java.nio.file.Paths;

/** Golden-value harness for cluster/pipe vein placement. Sections marked REAL TFC SOURCE are
 * extracted verbatim by tools/parity/capture-tfc-cluster-pipe.mjs. Not shipped. */
public class ClusterPipeFixture {
    static final long GOLDEN_RATIO_64 = 0x9e3779b97f4a7c15L;
    static final long SILVER_RATIO_64 = 0x6a09e667f3bcc909L;

    static class RandomSource {
        long lo, hi;
        RandomSource(long seedLo, long seedHi) {
            this.lo = seedLo; this.hi = seedHi;
            if ((this.lo | this.hi) == 0) { this.lo = GOLDEN_RATIO_64; this.hi = SILVER_RATIO_64; }
        }
        long nextLong() {
            long l0 = lo, l1 = hi;
            long result = Long.rotateLeft(l0 + l1, 17) + l0;
            long newHi = l1 ^ l0;
            long newLo = Long.rotateLeft(l0, 49) ^ newHi ^ (newHi << 21);
            lo = newLo; hi = Long.rotateLeft(newHi, 28);
            return result;
        }
        int nextInt() { return (int) nextLong(); }
        int nextInt(int bound) {
            if (bound <= 0) throw new IllegalArgumentException("bound must be positive");
            long threshold = Integer.toUnsignedLong(-bound) % bound;
            long product;
            do { product = Integer.toUnsignedLong(nextInt()) * (long) bound; }
            while ((product & 0xffffffffL) < threshold);
            return (int) (product >>> 32);
        }
        double nextDouble() { return (double) (nextLong() >>> 11) * 1.1102230246251565E-16; }
        float nextFloat() { return (float) (nextLong() >>> 40) * 5.9604645E-8F; }
    }

    /** Only the two members the extracted snippets call. */
    static class Mth {
        static float cos(float f) { return (float) Math.cos(f); }
        static float sin(float f) { return (float) Math.sin(f); }
    }

    static class BlockPos {
        final int x, y, z;
        BlockPos(int x, int y, int z) { this.x = x; this.y = y; this.z = z; }
        int getX() { return x; } int getY() { return y; } int getZ() { return z; }
    }
    static class WorldGenerationContext {}

    // ---- REAL TFC SOURCE: net.dries007.tfc.util.Helpers ----
    static class Helpers {
        ${uniformInt}
        ${uniformDouble}
        ${triangleDouble}
    }

    // ---- REAL TFC SOURCE: net.dries007.tfc.world.noise.Metaballs3D ----
    static class Metaballs3D {
        ${simple3d}
        private final Ball[] balls;
        ${ctor3d}
        record Ball(double x, double y, double z, double weight) {}
    }

    // ---- config data holders: accessor names only, no logic ----
    static class VeinConfigData {
        final int rarity; final int minY, maxY; final double density;
        VeinConfigData(int rarity, int minY, int maxY, double density) {
            this.rarity = rarity; this.minY = minY; this.maxY = maxY; this.density = density;
        }
        int rarity() { return rarity; } double density() { return density; }
    }
    static class ClusterConfig {
        final VeinConfigData c; final int size;
        ClusterConfig(VeinConfigData c, int size) { this.c = c; this.size = size; }
        VeinConfigData config() { return c; }
        int minY() { return c.minY; } int maxY() { return c.maxY; }
        int size() { return size; }
        int verticalRadius() { return size; }
    }
    static class PipeConfig {
        final VeinConfigData c; final int height, radius, minSkew, maxSkew, minSlant, maxSlant; final float sign;
        PipeConfig(VeinConfigData c, int height, int radius, int minSkew, int maxSkew, int minSlant, int maxSlant, float sign) {
            this.c = c; this.height = height; this.radius = radius; this.minSkew = minSkew;
            this.maxSkew = maxSkew; this.minSlant = minSlant; this.maxSlant = maxSlant; this.sign = sign;
        }
        VeinConfigData config() { return c; }
        int minY() { return c.minY; } int maxY() { return c.maxY; }
        int height() { return height; } int radius() { return radius; }
        int minSkew() { return minSkew; } int maxSkew() { return maxSkew; }
        int minSlant() { return minSlant; } int maxSlant() { return maxSlant; }
        float sign() { return sign; }
        int verticalRadius() { return height; }
    }

    // ---- REAL TFC SOURCE: ClusterVeinFeature ----
    static class ClusterVeinFeature {
        record Vein(BlockPos pos, Metaballs3D metaballs) {}
        ${clusterCreateMono}
        ${clusterPos}
        ${clusterYPos}
    }

    // ---- REAL TFC SOURCE: PipeVeinFeature ----
    static class PipeVeinFeature {
        record Vein(BlockPos pos, int sign, float skewX, float skewZ, int skew, int slant) {}
        ${pipeCreateMono}
        ${pipePos}
        ${pipeYPos}
    }

    public static void main(String[] args) throws Exception {
        long[][] seeds = { {1L, 2L}, {-6696614430994881185L, 987654321L}, {123456789L, -42L}, {99L, -7L} };
        // (rarity, minY, maxY, size) -- shaped after real entries in src/data/*/veins.json.
        int[][] clusters = { {190, -50, 20, 37}, {30, -64, 100, 12}, {80, 10, 70, 25}, {1, 0, 40, 8} };
        // (rarity, minY, maxY, height, radius, minSkew, maxSkew, minSlant, maxSlant, signPercent)
        int[][] pipes = { {180, -50, 20, 60, 10, 7, 20, 2, 5, 0}, {30, -64, 100, 60, 8, 4, 12, 1, 3, 50}, {1, 0, 40, 20, 5, 3, 3, 2, 2, 100} };

        StringBuilder out = new StringBuilder();
        out.append("{\\n  \\"source\\": \\"TFC 1.20.x ClusterVeinFeature/PipeVeinFeature createVein + VeinFeature defaultPos/defaultYPos, verbatim, via tools/parity/capture-tfc-cluster-pipe.mjs\\",\\n");

        out.append("  \\"cluster\\": [\\n");
        boolean first = true;
        for (long[] s : seeds) for (int[] cfg : clusters) for (int chunk = 0; chunk < 3; chunk++) {
            int chunkX = chunk * 7 - 7, chunkZ = chunk * -5 + 3;
            RandomSource r = new RandomSource(s[0], s[1]);
            int roll = r.nextInt(cfg[0]);
            ClusterConfig config = new ClusterConfig(new VeinConfigData(cfg[0], cfg[1], cfg[2], 0.3), cfg[3]);
            ClusterVeinFeature.Vein v = new ClusterVeinFeature().createVein(null, chunkX << 4, chunkZ << 4, r, config);
            if (!first) out.append(",\\n"); first = false;
            out.append("    {\\"seedLo\\": \\"").append(s[0]).append("\\", \\"seedHi\\": \\"").append(s[1])
               .append("\\", \\"rarity\\": ").append(cfg[0]).append(", \\"minY\\": ").append(cfg[1])
               .append(", \\"maxY\\": ").append(cfg[2]).append(", \\"size\\": ").append(cfg[3])
               .append(", \\"chunkX\\": ").append(chunkX).append(", \\"chunkZ\\": ").append(chunkZ)
               .append(", \\"roll\\": ").append(roll)
               .append(", \\"x\\": ").append(v.pos().getX()).append(", \\"y\\": ").append(v.pos().getY())
               .append(", \\"z\\": ").append(v.pos().getZ()).append("}");
        }
        out.append("\\n  ],\\n  \\"pipe\\": [\\n");
        first = true;
        for (long[] s : seeds) for (int[] cfg : pipes) for (int chunk = 0; chunk < 3; chunk++) {
            int chunkX = chunk * 7 - 7, chunkZ = chunk * -5 + 3;
            RandomSource r = new RandomSource(s[0], s[1]);
            int roll = r.nextInt(cfg[0]);
            PipeConfig config = new PipeConfig(new VeinConfigData(cfg[0], cfg[1], cfg[2], 0.22),
                cfg[3], cfg[4], cfg[5], cfg[6], cfg[7], cfg[8], cfg[9] / 100f);
            PipeVeinFeature.Vein v = new PipeVeinFeature().createVein(null, chunkX << 4, chunkZ << 4, r, config);
            if (!first) out.append(",\\n"); first = false;
            out.append("    {\\"seedLo\\": \\"").append(s[0]).append("\\", \\"seedHi\\": \\"").append(s[1])
               .append("\\", \\"rarity\\": ").append(cfg[0]).append(", \\"minY\\": ").append(cfg[1])
               .append(", \\"maxY\\": ").append(cfg[2]).append(", \\"height\\": ").append(cfg[3])
               .append(", \\"radius\\": ").append(cfg[4]).append(", \\"minSkew\\": ").append(cfg[5])
               .append(", \\"maxSkew\\": ").append(cfg[6]).append(", \\"minSlant\\": ").append(cfg[7])
               .append(", \\"maxSlant\\": ").append(cfg[8]).append(", \\"sign\\": ").append(cfg[9] / 100f)
               .append(", \\"chunkX\\": ").append(chunkX).append(", \\"chunkZ\\": ").append(chunkZ)
               .append(", \\"roll\\": ").append(roll)
               .append(", \\"x\\": ").append(v.pos().getX()).append(", \\"y\\": ").append(v.pos().getY())
               .append(", \\"z\\": ").append(v.pos().getZ())
               .append(", \\"skew\\": ").append(v.skew()).append(", \\"slant\\": ").append(v.slant())
               .append(", \\"veinSign\\": ").append(v.sign()).append("}");
        }
        out.append("\\n  ]\\n}\\n");
        Files.write(Paths.get(args[0]), out.toString().getBytes("UTF-8"));
    }
}
`;

const workDir = mkdtempSync(join(tmpdir(), 'tfc-cluster-pipe-'));
const javaFile = join(workDir, 'ClusterPipeFixture.java');
writeFileSync(javaFile, harness);
mkdirSync(resolve('tools/parity/out'), { recursive: true });
writeFileSync(resolve('tools/parity/out/ClusterPipeFixture.java'), harness);
mkdirSync(resolve('tests/fixtures/tfc-1.20'), { recursive: true });
const outPath = resolve('tests/fixtures/tfc-1.20/cluster-pipe-veins.json');

execFileSync('javac', ['-d', workDir, javaFile], { stdio: 'inherit' });
execFileSync('java', ['-cp', workDir, 'ClusterPipeFixture', outPath], { stdio: 'inherit' });
console.log(`wrote ${outPath}`);
