import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.security.MessageDigest;

/**
 * Independent Java reimplementation of xoroshiro128++ + RandomSupport's seed mixing + Mth.getSeed,
 * from the published algorithm/constants (see the provenance note in src/core/random/xoroshiro.ts —
 * this is NOT decompiled Mojang source, CLAUDE.md section 8 forbids that). Dumps golden values for
 * tests/fixtures/core/xoroshiro.json. Not shipped; source committed, output gitignored.
 */
public class XoroshiroFixture {
    static final long GOLDEN_RATIO_64 = 0x9e3779b97f4a7c15L;
    static final long SILVER_RATIO_64 = 0x6a09e667f3bcc909L;
    static final long MIX13_A = 0xbf58476d1ce4e5b9L;
    static final long MIX13_B = 0x94d049bb133111ebL;

    static long mixStafford13(long seed) {
        seed = (seed ^ (seed >>> 30)) * MIX13_A;
        seed = (seed ^ (seed >>> 27)) * MIX13_B;
        return seed ^ (seed >>> 31);
    }

    static long[] upgradeSeedTo128bitUnmixed(long seed) {
        long lo = seed ^ SILVER_RATIO_64;
        long hi = lo + GOLDEN_RATIO_64;
        return new long[]{lo, hi};
    }

    static long[] upgradeSeedTo128bit(long seed) {
        long[] u = upgradeSeedTo128bitUnmixed(seed);
        return new long[]{mixStafford13(u[0]), mixStafford13(u[1])};
    }

    static long positionalSeed(int x, int y, int z) {
        long l = (long) (x * 3129871) ^ (long) z * 116129781L ^ (long) y;
        l = l * l * 42317861L + l * 11L;
        return l >> 16;
    }

    static long[] seedFromHashOf(String name) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] digest = md.digest(name.getBytes(StandardCharsets.UTF_8));
        java.nio.ByteBuffer buf = java.nio.ByteBuffer.wrap(digest);
        return new long[]{buf.getLong(), buf.getLong()};
    }

    /** One xoroshiro128++ state-advance step. */
    static class Xoroshiro {
        long lo, hi;

        Xoroshiro(long lo, long hi) {
            this.lo = lo;
            this.hi = hi;
        }

        static Xoroshiro fromSeed(long seed) {
            long[] s = upgradeSeedTo128bit(seed);
            return new Xoroshiro(s[0], s[1]);
        }

        long nextLong() {
            long l = lo;
            long h = hi;
            long result = Long.rotateLeft(l + h, 17) + l;
            h ^= l;
            lo = Long.rotateLeft(l, 49) ^ h ^ (h << 21);
            hi = Long.rotateLeft(h, 28);
            return result;
        }

        int next(int bits) {
            return (int) (nextLong() >>> (64 - bits));
        }

        int nextInt() {
            return next(32);
        }

        int nextInt(int bound) {
            if ((bound & -bound) == bound) {
                return (int) ((bound * (long) next(31)) >> 31);
            }
            int bitsVal, val;
            do {
                bitsVal = next(31);
                val = bitsVal % bound;
            } while (bitsVal - val + (bound - 1) < 0);
            return val;
        }

        boolean nextBoolean() {
            return next(1) != 0;
        }

        float nextFloat() {
            return next(24) / (float) (1 << 24);
        }

        double nextDouble() {
            return (((long) next(26) << 27) + next(27)) / (double) (1L << 53);
        }
    }

    static StringBuilder sb = new StringBuilder();
    static boolean first = true;

    static void comma() {
        if (!first) sb.append(",\n");
        first = false;
    }

    public static void main(String[] args) throws Exception {
        sb.append("{\n");
        sb.append("  \"source\": \"independent Java reimplementation of xoroshiro128++ / RandomSupport / Mth.getSeed, from the published algorithm \\u2014 see the provenance note in src/core/random/xoroshiro.ts. SHA-256 via the real JDK.\",\n");
        sb.append("  \"capturedAt\": \"2026-09-05\",\n");
        sb.append("  \"seed\": \"various \\u2014 see cases[].seed\",\n");
        sb.append("  \"cases\": [\n");

        long[] seeds = {0L, 1L, -1L, 42L, 123456789L, -987654321L, Long.MIN_VALUE, Long.MAX_VALUE};

        for (long seed : seeds) {
            comma();
            long[] up = upgradeSeedTo128bit(seed);
            sb.append("    { \"op\": \"upgradeSeedTo128bit\", \"seed\": \"").append(seed).append("\", \"lo\": \"")
                    .append(up[0]).append("\", \"hi\": \"").append(up[1]).append("\" }");

            Xoroshiro x = Xoroshiro.fromSeed(seed);
            comma();
            sb.append("    { \"op\": \"nextLong\", \"seed\": \"").append(seed).append("\", \"n\": 6, \"out\": [");
            for (int i = 0; i < 6; i++) {
                if (i > 0) sb.append(", ");
                sb.append("\"").append(x.nextLong()).append("\"");
            }
            sb.append("] }");

            Xoroshiro x2 = Xoroshiro.fromSeed(seed);
            comma();
            sb.append("    { \"op\": \"nextIntBound\", \"seed\": \"").append(seed).append("\", \"bound\": 37, \"n\": 6, \"out\": [");
            for (int i = 0; i < 6; i++) {
                if (i > 0) sb.append(", ");
                sb.append(x2.nextInt(37));
            }
            sb.append("] }");

            Xoroshiro x2b = Xoroshiro.fromSeed(seed);
            comma();
            sb.append("    { \"op\": \"nextIntBound\", \"seed\": \"").append(seed).append("\", \"bound\": 64, \"n\": 6, \"out\": [");
            for (int i = 0; i < 6; i++) {
                if (i > 0) sb.append(", ");
                sb.append(x2b.nextInt(64));
            }
            sb.append("] }");

            Xoroshiro x3 = Xoroshiro.fromSeed(seed);
            comma();
            sb.append("    { \"op\": \"nextDouble\", \"seed\": \"").append(seed).append("\", \"n\": 4, \"out\": [");
            for (int i = 0; i < 4; i++) {
                if (i > 0) sb.append(", ");
                sb.append(x3.nextDouble());
            }
            sb.append("] }");

            Xoroshiro x4 = Xoroshiro.fromSeed(seed);
            comma();
            sb.append("    { \"op\": \"nextFloat\", \"seed\": \"").append(seed).append("\", \"n\": 4, \"out\": [");
            for (int i = 0; i < 4; i++) {
                if (i > 0) sb.append(", ");
                sb.append(x4.nextFloat());
            }
            sb.append("] }");

            Xoroshiro x5 = Xoroshiro.fromSeed(seed);
            comma();
            sb.append("    { \"op\": \"nextBoolean\", \"seed\": \"").append(seed).append("\", \"n\": 8, \"out\": [");
            for (int i = 0; i < 8; i++) {
                if (i > 0) sb.append(", ");
                sb.append(x5.nextBoolean());
            }
            sb.append("] }");
        }

        // positionalSeed (Mth.getSeed) at assorted coordinates, including negatives to exercise
        // the 32-bit int-multiply-overflow-before-widening-to-long step.
        int[][] positions = {{0, 0, 0}, {1, 2, 3}, {-1, -2, -3}, {1000000, 64, -1000000}, {-2147483648, 0, 2147483647}};
        for (int[] pos : positions) {
            comma();
            sb.append("    { \"op\": \"positionalSeed\", \"x\": ").append(pos[0]).append(", \"y\": ").append(pos[1])
                    .append(", \"z\": ").append(pos[2]).append(", \"out\": \"").append(positionalSeed(pos[0], pos[1], pos[2])).append("\" }");
        }

        // PositionalRandomFactory.at(x, y, z): base seed upgraded to 128-bit, then per-position.
        long[] baseSeeds = {0L, 42L, -1234567890123L};
        int[][] atPositions = {{0, 0, 0}, {100, 64, -100}, {-5, 5, -5}};
        for (long baseSeed : baseSeeds) {
            long[] base = upgradeSeedTo128bit(baseSeed);
            for (int[] pos : atPositions) {
                long posSeed = positionalSeed(pos[0], pos[1], pos[2]);
                Xoroshiro at = new Xoroshiro(posSeed ^ base[0], base[1]);
                comma();
                sb.append("    { \"op\": \"positionalFactoryAt\", \"baseSeed\": \"").append(baseSeed).append("\", \"x\": ")
                        .append(pos[0]).append(", \"y\": ").append(pos[1]).append(", \"z\": ").append(pos[2])
                        .append(", \"n\": 4, \"out\": [");
                for (int i = 0; i < 4; i++) {
                    if (i > 0) sb.append(", ");
                    sb.append("\"").append(at.nextLong()).append("\"");
                }
                sb.append("] }");
            }
        }

        // PositionalRandomFactory.fromHashOf(name).
        String[] names = {"minecraft:ore_vein", "tfc:cluster_vein", ""};
        for (long baseSeed : baseSeeds) {
            long[] base = upgradeSeedTo128bit(baseSeed);
            for (String name : names) {
                long[] nameSeed = seedFromHashOf(name);
                Xoroshiro fh = new Xoroshiro(nameSeed[0] ^ base[0], nameSeed[1] ^ base[1]);
                comma();
                sb.append("    { \"op\": \"positionalFactoryFromHashOf\", \"baseSeed\": \"").append(baseSeed)
                        .append("\", \"name\": \"").append(name).append("\", \"n\": 4, \"out\": [");
                for (int i = 0; i < 4; i++) {
                    if (i > 0) sb.append(", ");
                    sb.append("\"").append(fh.nextLong()).append("\"");
                }
                sb.append("] }");
            }
        }

        sb.append("\n  ]\n}\n");
        Files.write(Paths.get(args.length > 0 ? args[0] : "xoroshiro.json"), sb.toString().getBytes("UTF-8"));
        System.out.println("wrote " + sb.length() + " bytes");
    }
}
