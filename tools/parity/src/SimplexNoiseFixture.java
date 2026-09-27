import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Random;

/**
 * Independent Java reimplementation of the classic Gustavson/Perlin 2D simplex noise algorithm,
 * permutation seeded via real java.util.Random exactly like ImprovedNoiseFixture — see the doc
 * comment on src/core/noise/simplex-noise.ts. Dumps golden values for
 * tests/fixtures/core/simplex-noise.json. Not shipped; source committed, output gitignored.
 */
public class SimplexNoiseFixture {
    static final double SQRT_3 = Math.sqrt(3);
    static final double F2 = 0.5 * (SQRT_3 - 1);
    static final double G2 = (3 - SQRT_3) / 6;

    static final int[][] GRADIENT = {
            {1, 1, 0}, {-1, 1, 0}, {1, -1, 0}, {-1, -1, 0},
            {1, 0, 1}, {-1, 0, 1}, {1, 0, -1}, {-1, 0, -1},
            {0, 1, 1}, {0, -1, 1}, {0, 1, -1}, {0, -1, -1},
            {1, 1, 0}, {0, -1, 1}, {-1, 1, 0}, {0, -1, -1},
    };

    final int[] p = new int[256];

    SimplexNoiseFixture(Random random) {
        random.nextDouble();
        random.nextDouble();
        random.nextDouble(); // xo, yo, zo — unused by getValue(x, y) but drawn to match the real
                              // constructor's RNG call sequence, so later shuffle draws line up.
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

    static double dot2(int[] g, double x, double y) {
        return g[0] * x + g[1] * y;
    }

    double getValue(double x, double y) {
        double skew = (x + y) * F2;
        int i = (int) Math.floor(x + skew);
        int j = (int) Math.floor(y + skew);
        double unskew = (i + j) * G2;
        double x0 = x - (i - unskew);
        double y0 = y - (j - unskew);

        int i1, j1;
        if (x0 > y0) {
            i1 = 1;
            j1 = 0;
        } else {
            i1 = 0;
            j1 = 1;
        }

        double x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
        double x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;

        int ii = i & 255, jj = j & 255;
        int gi0 = p(ii + p(jj)) % 12;
        int gi1 = p(ii + i1 + p(jj + j1)) % 12;
        int gi2 = p(ii + 1 + p(jj + 1)) % 12;

        double n0 = 0, n1 = 0, n2 = 0;
        double t0 = 0.5 - x0 * x0 - y0 * y0;
        if (t0 >= 0) {
            t0 *= t0;
            n0 = t0 * t0 * dot2(GRADIENT[gi0], x0, y0);
        }
        double t1 = 0.5 - x1 * x1 - y1 * y1;
        if (t1 >= 0) {
            t1 *= t1;
            n1 = t1 * t1 * dot2(GRADIENT[gi1], x1, y1);
        }
        double t2 = 0.5 - x2 * x2 - y2 * y2;
        if (t2 >= 0) {
            t2 *= t2;
            n2 = t2 * t2 * dot2(GRADIENT[gi2], x2, y2);
        }
        return 70 * (n0 + n1 + n2);
    }

    static StringBuilder sb = new StringBuilder();
    static boolean first = true;

    static void comma() {
        if (!first) sb.append(",\n");
        first = false;
    }

    public static void main(String[] args) throws Exception {
        sb.append("{\n");
        sb.append("  \"source\": \"independent Java reimplementation of the classic Gustavson/Perlin 2D simplex noise algorithm, permutation seeded via real java.util.Random \\u2014 see the doc comment in src/core/noise/simplex-noise.ts\",\n");
        sb.append("  \"capturedAt\": \"2026-09-05\",\n");
        sb.append("  \"seed\": \"various \\u2014 see cases[].seed\",\n");
        sb.append("  \"cases\": [\n");

        long[] seeds = {0L, 1L, 42L, -987654321L};
        double[][] points = {
                {0, 0}, {0.5, 0.5}, {1.25, -3.75}, {-100.5, 64.0}, {17.3, -0.2}, {5.0, 5.0},
        };

        for (long seed : seeds) {
            SimplexNoiseFixture noise = new SimplexNoiseFixture(new Random(seed));
            comma();
            sb.append("    { \"op\": \"sample\", \"seed\": \"").append(seed).append("\", \"points\": [");
            for (int i = 0; i < points.length; i++) {
                if (i > 0) sb.append(", ");
                sb.append("[").append(points[i][0]).append(", ").append(points[i][1]).append("]");
            }
            sb.append("], \"out\": [");
            for (int i = 0; i < points.length; i++) {
                if (i > 0) sb.append(", ");
                sb.append(noise.getValue(points[i][0], points[i][1]));
            }
            sb.append("] }");
        }

        sb.append("\n  ]\n}\n");
        Files.write(Paths.get(args.length > 0 ? args[0] : "simplex-noise.json"), sb.toString().getBytes("UTF-8"));
        System.out.println("wrote " + sb.length() + " bytes");
    }
}
