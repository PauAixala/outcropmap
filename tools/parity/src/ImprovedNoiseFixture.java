import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Random;

/**
 * Independent Java reimplementation of the public-domain "improved Perlin noise" algorithm, with a
 * java.util.Random-seeded permutation table exactly like vanilla's ImprovedNoise construction (see
 * the provenance note in src/core/random/xoroshiro.ts and the doc comment on
 * src/core/noise/improved-noise.ts — not decompiled Mojang source). Since java.util.Random itself is
 * independently verified bit-for-bit (tests/fixtures/core/java-random.json), this fixture mainly
 * checks the noise math (fade/grad/lerp) port. Dumps golden values for
 * tests/fixtures/core/improved-noise.json. Not shipped; source committed, output gitignored.
 */
public class ImprovedNoiseFixture {
    final double xo, yo, zo;
    final int[] p = new int[256];

    ImprovedNoiseFixture(Random random) {
        xo = random.nextDouble() * 256.0;
        yo = random.nextDouble() * 256.0;
        zo = random.nextDouble() * 256.0;
        for (int i = 0; i < 256; i++) p[i] = i;
        for (int i = 0; i < 256; i++) {
            int j = random.nextInt(256 - i);
            int tmp = p[i];
            p[i] = p[i + j];
            p[i + j] = tmp;
        }
    }

    int p(int i) {
        return p[i & 255];
    }

    static double fade(double t) {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    static double grad(int hash, double x, double y, double z) {
        int h = hash & 15;
        double u = h < 8 ? x : y;
        double v = h < 4 ? y : (h == 12 || h == 14 ? x : z);
        return ((h & 1) == 0 ? u : -u) + ((h & 2) == 0 ? v : -v);
    }

    static double lerp(double t, double a, double b) {
        return a + t * (b - a);
    }

    double sample(double x, double y, double z) {
        return sampleWithYClamp(x, y, z, 0.0, 0.0);
    }

    double sampleWithYClamp(double x, double y, double z, double yScale, double yMax) {
        double xp = x + xo, yp = y + yo, zp = z + zo;
        int xi = (int) Math.floor(xp), yi = (int) Math.floor(yp), zi = (int) Math.floor(zp);
        double xd = xp - xi, yd = yp - yi, zd = zp - zi;
        double clampedYd = yd;
        if (yScale != 0.0) {
            double clampedYMax = (yMax >= 0.0 && yMax < yd) ? yMax : yd;
            clampedYd = Math.floor(clampedYMax / yScale) * yScale;
        }
        return sampleAndLerp(xi, yi, zi, xd, clampedYd, zd, yd);
    }

    double sampleAndLerp(int gx, int gy, int gz, double dx, double dy, double dz, double fadeY) {
        int i = p(gx), j = p(gx + 1);
        int k = p(i + gy), l = p(i + gy + 1);
        int i1 = p(j + gy), j1 = p(j + gy + 1);
        double d0 = grad(p(k + gz), dx, dy, dz);
        double d1 = grad(p(i1 + gz), dx - 1, dy, dz);
        double d2 = grad(p(l + gz), dx, dy - 1, dz);
        double d3 = grad(p(j1 + gz), dx - 1, dy - 1, dz);
        double d4 = grad(p(k + gz + 1), dx, dy, dz - 1);
        double d5 = grad(p(i1 + gz + 1), dx - 1, dy, dz - 1);
        double d6 = grad(p(l + gz + 1), dx, dy - 1, dz - 1);
        double d7 = grad(p(j1 + gz + 1), dx - 1, dy - 1, dz - 1);
        double u = fade(dx), v = fade(fadeY), w = fade(dz);
        return lerp(w, lerp(v, lerp(u, d0, d1), lerp(u, d2, d3)), lerp(v, lerp(u, d4, d5), lerp(u, d6, d7)));
    }

    static StringBuilder sb = new StringBuilder();
    static boolean first = true;

    static void comma() {
        if (!first) sb.append(",\n");
        first = false;
    }

    public static void main(String[] args) throws Exception {
        sb.append("{\n");
        sb.append("  \"source\": \"independent Java reimplementation of the public-domain improved-noise algorithm, permutation seeded via real java.util.Random \\u2014 see the doc comment in src/core/noise/improved-noise.ts\",\n");
        sb.append("  \"capturedAt\": \"2026-09-05\",\n");
        sb.append("  \"seed\": \"various \\u2014 see cases[].seed\",\n");
        sb.append("  \"cases\": [\n");

        long[] seeds = {0L, 1L, 42L, -987654321L};
        double[][] points = {
                {0, 0, 0}, {0.5, 0.5, 0.5}, {1.25, -3.75, 10.0}, {-100.5, 64.0, 200.25}, {17.3, -0.2, -5.6},
        };

        for (long seed : seeds) {
            ImprovedNoiseFixture noise = new ImprovedNoiseFixture(new Random(seed));
            comma();
            sb.append("    { \"op\": \"sample\", \"seed\": \"").append(seed).append("\", \"points\": [");
            for (int i = 0; i < points.length; i++) {
                if (i > 0) sb.append(", ");
                sb.append("[").append(points[i][0]).append(", ").append(points[i][1]).append(", ").append(points[i][2]).append("]");
            }
            sb.append("], \"out\": [");
            for (int i = 0; i < points.length; i++) {
                if (i > 0) sb.append(", ");
                sb.append(noise.sample(points[i][0], points[i][1], points[i][2]));
            }
            sb.append("] }");

            ImprovedNoiseFixture noise2 = new ImprovedNoiseFixture(new Random(seed));
            comma();
            sb.append("    { \"op\": \"sampleWithYClamp\", \"seed\": \"").append(seed)
                    .append("\", \"yScale\": 0.5, \"yMax\": 2.0, \"points\": [");
            for (int i = 0; i < points.length; i++) {
                if (i > 0) sb.append(", ");
                sb.append("[").append(points[i][0]).append(", ").append(points[i][1]).append(", ").append(points[i][2]).append("]");
            }
            sb.append("], \"out\": [");
            for (int i = 0; i < points.length; i++) {
                if (i > 0) sb.append(", ");
                sb.append(noise2.sampleWithYClamp(points[i][0], points[i][1], points[i][2], 0.5, 2.0));
            }
            sb.append("] }");
        }

        sb.append("\n  ]\n}\n");
        Files.write(Paths.get(args.length > 0 ? args[0] : "improved-noise.json"), sb.toString().getBytes("UTF-8"));
        System.out.println("wrote " + sb.length() + " bytes");
    }
}
