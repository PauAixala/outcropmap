import java.util.Random;

/**
 * Dumps golden values from the REAL JDK java.util.Random for tests/fixtures/core/java-random.json.
 * Not shipped; regenerate with `tools/parity/run.sh` (or run.bat on Windows) whenever the fixture
 * needs to be refreshed. Output is gitignored (tools/parity/out/), this source is committed.
 */
public class JavaRandomFixture {
    static StringBuilder sb = new StringBuilder();

    public static void main(String[] args) throws Exception {
        sb.append("{\n");
        sb.append("  \"source\": \"java.util.Random (real JDK ").append(System.getProperty("java.version")).append(", java.base) \\u2014 the actual standard-library class, not a reimplementation\",\n");
        sb.append("  \"capturedAt\": \"2026-09-05\",\n");
        sb.append("  \"seed\": \"various \\u2014 see cases[].seed\",\n");
        sb.append("  \"cases\": [\n");

        boolean first = true;
        long[] seeds = { 0L, 1L, -1L, 42L, 123456789L, -987654321L, Long.MIN_VALUE, Long.MAX_VALUE, -1234567890123L };

        for (long seed : seeds) {
            first = emitNextInt(seed, 8, first);
            first = emitNextIntBound(seed, 16, 8, first);   // power of two
            first = emitNextIntBound(seed, 37, 8, first);   // not a power of two
            first = emitNextIntBound(seed, 1, 4, first);    // degenerate bound
            first = emitNextIntBound(seed, 1000000, 8, first);
            first = emitNextLong(seed, 6, first);
            first = emitNextFloat(seed, 6, first);
            first = emitNextDouble(seed, 6, first);
            first = emitNextBoolean(seed, 10, first);
            first = emitNextGaussian(seed, 6, first);
        }

        sb.append("\n  ]\n}\n");

        java.nio.file.Files.write(java.nio.file.Paths.get(args.length > 0 ? args[0] : "java-random.json"),
                sb.toString().getBytes("UTF-8"));
        System.out.println("wrote " + sb.length() + " bytes");
    }

    static void comma(boolean first) {
        if (!first) sb.append(",\n");
    }

    static boolean emitNextInt(long seed, int n, boolean first) {
        Random r = new Random(seed);
        comma(first);
        sb.append("    { \"op\": \"nextInt\", \"seed\": \"").append(seed).append("\", \"n\": ").append(n).append(", \"out\": [");
        for (int i = 0; i < n; i++) {
            if (i > 0) sb.append(", ");
            sb.append(r.nextInt());
        }
        sb.append("] }");
        return false;
    }

    static boolean emitNextIntBound(long seed, int bound, int n, boolean first) {
        Random r = new Random(seed);
        comma(first);
        sb.append("    { \"op\": \"nextIntBound\", \"seed\": \"").append(seed).append("\", \"bound\": ").append(bound)
                .append(", \"n\": ").append(n).append(", \"out\": [");
        for (int i = 0; i < n; i++) {
            if (i > 0) sb.append(", ");
            sb.append(r.nextInt(bound));
        }
        sb.append("] }");
        return false;
    }

    static boolean emitNextLong(long seed, int n, boolean first) {
        Random r = new Random(seed);
        comma(first);
        sb.append("    { \"op\": \"nextLong\", \"seed\": \"").append(seed).append("\", \"n\": ").append(n).append(", \"out\": [");
        for (int i = 0; i < n; i++) {
            if (i > 0) sb.append(", ");
            sb.append("\"").append(r.nextLong()).append("\"");
        }
        sb.append("] }");
        return false;
    }

    static boolean emitNextFloat(long seed, int n, boolean first) {
        Random r = new Random(seed);
        comma(first);
        sb.append("    { \"op\": \"nextFloat\", \"seed\": \"").append(seed).append("\", \"n\": ").append(n).append(", \"out\": [");
        for (int i = 0; i < n; i++) {
            if (i > 0) sb.append(", ");
            sb.append(r.nextFloat());
        }
        sb.append("] }");
        return false;
    }

    static boolean emitNextDouble(long seed, int n, boolean first) {
        Random r = new Random(seed);
        comma(first);
        sb.append("    { \"op\": \"nextDouble\", \"seed\": \"").append(seed).append("\", \"n\": ").append(n).append(", \"out\": [");
        for (int i = 0; i < n; i++) {
            if (i > 0) sb.append(", ");
            sb.append(r.nextDouble());
        }
        sb.append("] }");
        return false;
    }

    static boolean emitNextBoolean(long seed, int n, boolean first) {
        Random r = new Random(seed);
        comma(first);
        sb.append("    { \"op\": \"nextBoolean\", \"seed\": \"").append(seed).append("\", \"n\": ").append(n).append(", \"out\": [");
        for (int i = 0; i < n; i++) {
            if (i > 0) sb.append(", ");
            sb.append(r.nextBoolean());
        }
        sb.append("] }");
        return false;
    }

    static boolean emitNextGaussian(long seed, int n, boolean first) {
        Random r = new Random(seed);
        comma(first);
        sb.append("    { \"op\": \"nextGaussian\", \"seed\": \"").append(seed).append("\", \"n\": ").append(n).append(", \"out\": [");
        for (int i = 0; i < n; i++) {
            if (i > 0) sb.append(", ");
            sb.append(r.nextGaussian());
        }
        sb.append("] }");
        return false;
    }
}
