/**
 * Captures golden values for the metaball ports that the cluster and disc vein features are built
 * on — `src/worldgen/tfc-1.20/features/metaballs-3d.ts` and `metaballs-2d.ts`.
 *
 * Usage: node tools/parity/capture-tfc-metaballs.mjs <TFC checkout>
 *   node tools/parity/capture-tfc-metaballs.mjs "$HOME/reference/tfc"
 *
 * These two carry more transcription risk per line than anything else in the vein path, because
 * every trap in them produces *plausible* output rather than an error:
 *
 * - `simple()` computes `0.1f * size`, `0.3f * size` and `0.5f * size` in **float**, then widens to
 *   the `double` constructor parameters. `0.3f * 37` is `11.100000381469727`, not `11.1`. Getting
 *   this wrong shifts every ball weight slightly and quietly changes the vein's shape.
 * - The two classes take a **different number of RNG draws**: 3D is `uniform(random, 5, 7)` balls
 *   with three `triangle` pairs plus one `uniform` each; 2D is `uniform(random, 3, 8)` balls with
 *   two `triangle` pairs plus one `uniform`. `Helpers.triangle` is two `nextDouble()` calls, not one.
 * - 2D draws its weight from `minSize`, 3D from `0` — so no 2D ball is ever near-weightless.
 * - `Metaballs2D.sample` has no `f > 1` early exit; `Metaballs3D.inside` does. Both disc chance
 *   functions scale by the *magnitude*, so a short-circuited 2D sample would silently flatten them.
 *
 * Same technique as capture-tfc-veins.mjs: the class bodies and the `Helpers` primitives below are
 * **verbatim, unmodified** TFC 1.20.x source, sliced out by brace matching, so a refactor upstream
 * throws (signature not found) rather than silently capturing stale text. Everything around them is
 * hand-written scaffolding — a from-scratch xoroshiro128++ whose `nextInt`/`nextDouble` are
 * themselves fixture-verified against the official Minecraft server (tests/fixtures/core/
 * xoroshiro.json's `nextDouble`/`nextFloat`/`nextIntBound` cases).
 */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const checkout = resolve(process.argv[2] ?? '');
if (!checkout) throw new Error('Usage: node capture-tfc-metaballs.mjs <TFC checkout>');
const noiseDir = join(checkout, 'src/main/java/net/dries007/tfc/world/noise');
const utilDir = join(checkout, 'src/main/java/net/dries007/tfc/util');

/** Same brace-matching method-body slicer as capture-tfc-veins.mjs. */
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

const balls3dSrc = readFileSync(join(noiseDir, 'Metaballs3D.java'), 'utf8');
const balls2dSrc = readFileSync(join(noiseDir, 'Metaballs2D.java'), 'utf8');
const helpersSrc = readFileSync(join(utilDir, 'Helpers.java'), 'utf8');

// --- verbatim TFC source ---
const simple3d = method(balls3dSrc, 'public static Metaballs3D simple(RandomSource random, int size)');
const ctor3d = method(
  balls3dSrc,
  'public Metaballs3D(RandomSource random, int minBalls, int maxBalls, double minSize, double maxSize, double radius)',
);
const inside3d = method(balls3dSrc, 'public boolean inside(double x, double y, double z)');

const simple2d = method(balls2dSrc, 'public static Metaballs2D simple(RandomSource random, int size)');
const ctor2d = method(
  balls2dSrc,
  'public Metaballs2D(RandomSource random, int minBalls, int maxBalls, double minSize, double maxSize, double radius)',
);
const sample2d = method(balls2dSrc, 'public double sample(double x, double z)');

const uniformInt = method(helpersSrc, 'public static int uniform(RandomSource random, int min, int max)');
const uniformDouble = method(helpersSrc, 'public static double uniform(RandomSource random, double min, double max)');
const triangleDouble = method(helpersSrc, 'public static double triangle(RandomSource random, double delta)');

const harness = `
import java.util.ArrayList;
import java.util.List;
import java.nio.file.Files;
import java.nio.file.Paths;

/**
 * Golden-value harness for Metaballs2D/Metaballs3D. Sections marked REAL TFC SOURCE are extracted
 * verbatim by tools/parity/capture-tfc-metaballs.mjs. Not shipped; output written to
 * tests/fixtures/tfc-1.20/metaballs.json.
 */
public class MetaballsFixture {
    static final long GOLDEN_RATIO_64 = 0x9e3779b97f4a7c15L;
    static final long SILVER_RATIO_64 = 0x6a09e667f3bcc909L;

    /** From-scratch xoroshiro128++, matching src/core/random/xoroshiro.ts, itself verified against
     * the official Minecraft server (tests/fixtures/core/xoroshiro.json). */
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
        ${inside3d}
        record Ball(double x, double y, double z, double weight) {}
    }

    // ---- REAL TFC SOURCE: net.dries007.tfc.world.noise.Metaballs2D ----
    static class Metaballs2D {
        ${simple2d}
        private final Ball[] balls;
        ${ctor2d}
        ${sample2d}
        record Ball(double x, double z, double weight) {}
    }

    static String json(double v) {
        if (v == Math.rint(v) && !Double.isInfinite(v)) return String.valueOf((long) v) + ".0";
        return String.valueOf(v);
    }

    public static void main(String[] args) throws Exception {
        long[][] seeds = { {1L, 2L}, {-6696614430994881185L, 987654321L}, {123456789L, -42L}, {7L, 7L} };
        int[] sizes = { 8, 18, 30, 37, 44 };
        StringBuilder out = new StringBuilder();
        out.append("{\\n  \\"source\\": \\"TFC 1.20.x Metaballs2D/Metaballs3D + Helpers, verbatim, via tools/parity/capture-tfc-metaballs.mjs\\",\\n  \\"cases\\": [\\n");
        boolean firstCase = true;
        for (long[] seed : seeds) {
            for (int size : sizes) {
                // --- 3D ---
                RandomSource r3 = new RandomSource(seed[0], seed[1]);
                Metaballs3D m3 = Metaballs3D.simple(r3, size);
                StringBuilder balls3 = new StringBuilder();
                for (int i = 0; i < m3.balls.length; i++) {
                    if (i > 0) balls3.append(", ");
                    Metaballs3D.Ball b = m3.balls[i];
                    balls3.append("[").append(json(b.x())).append(", ").append(json(b.y())).append(", ")
                          .append(json(b.z())).append(", ").append(json(b.weight())).append("]");
                }
                // Deterministic probe lattice across the vein's own bounding box.
                StringBuilder inside3 = new StringBuilder();
                int step3 = Math.max(1, size / 3);
                int n3 = 0;
                for (int x = -size; x <= size; x += step3)
                    for (int y = -size; y <= size; y += step3)
                        for (int z = -size; z <= size; z += step3) {
                            if (n3 > 0) inside3.append(", ");
                            inside3.append(m3.inside(x, y, z) ? "1" : "0");
                            n3++;
                        }
                // Exact count of integer positions inside the shape -- what typicalVeinBlocks sums.
                long insideCount = 0;
                for (int x = -size; x <= size; x++)
                    for (int y = -size; y <= size; y++)
                        for (int z = -size; z <= size; z++)
                            if (m3.inside(x, y, z)) insideCount++;
                // --- 2D ---
                RandomSource r2 = new RandomSource(seed[0], seed[1]);
                Metaballs2D m2 = Metaballs2D.simple(r2, size);
                StringBuilder balls2 = new StringBuilder();
                for (int i = 0; i < m2.balls.length; i++) {
                    if (i > 0) balls2.append(", ");
                    Metaballs2D.Ball b = m2.balls[i];
                    balls2.append("[").append(json(b.x())).append(", ").append(json(b.z())).append(", ")
                          .append(json(b.weight())).append("]");
                }
                StringBuilder sample2 = new StringBuilder();
                int step2 = Math.max(1, size / 4);
                int n2 = 0;
                for (int x = -size; x <= size; x += step2)
                    for (int z = -size; z <= size; z += step2) {
                        if (n2 > 0) sample2.append(", ");
                        sample2.append(json(m2.sample(x, z)));
                        n2++;
                    }
                long footprint = 0;
                for (int x = -size; x <= size; x++)
                    for (int z = -size; z <= size; z++)
                        if (m2.sample(x, z) > 1f) footprint++;

                if (!firstCase) out.append(",\\n");
                firstCase = false;
                out.append("    {\\"seedLo\\": \\"").append(seed[0]).append("\\", \\"seedHi\\": \\"").append(seed[1])
                   .append("\\", \\"size\\": ").append(size)
                   .append(", \\"step3\\": ").append(step3).append(", \\"step2\\": ").append(step2)
                   .append(",\\n     \\"balls3d\\": [").append(balls3).append("],")
                   .append("\\n     \\"inside3d\\": [").append(inside3).append("],")
                   .append("\\n     \\"insideCount3d\\": ").append(insideCount).append(",")
                   .append("\\n     \\"balls2d\\": [").append(balls2).append("],")
                   .append("\\n     \\"sample2d\\": [").append(sample2).append("],")
                   .append("\\n     \\"footprint2d\\": ").append(footprint)
                   .append("}");
            }
        }
        out.append("\\n  ]\\n}\\n");
        Files.write(Paths.get(args[0]), out.toString().getBytes("UTF-8"));
    }
}
`;

const workDir = mkdtempSync(join(tmpdir(), 'tfc-metaballs-'));
const javaFile = join(workDir, 'MetaballsFixture.java');
writeFileSync(javaFile, harness);

const outPath = resolve('tests/fixtures/tfc-1.20/metaballs.json');
mkdirSync(resolve('tests/fixtures/tfc-1.20'), { recursive: true });
mkdirSync(resolve('tools/parity/out'), { recursive: true });
writeFileSync(resolve('tools/parity/out/MetaballsFixture.java'), harness);

execFileSync('javac', ['-d', workDir, javaFile], { stdio: 'inherit' });
execFileSync('java', ['-cp', workDir, 'MetaballsFixture', outPath], { stdio: 'inherit' });
console.log(`wrote ${outPath}`);
