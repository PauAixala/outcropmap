import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

/**
 * Dumps golden values from real java.lang.String.hashCode() and java.lang.Long.parseLong() for
 * tests/fixtures/core/seed.json. Not shipped; source committed, output gitignored.
 */
public class SeedFixture {
    public static void main(String[] args) throws Exception {
        StringBuilder sb = new StringBuilder();
        sb.append("{\n");
        sb.append("  \"source\": \"java.lang.String.hashCode() and java.lang.Long.parseLong(String) \\u2014 real JDK ")
                .append(System.getProperty("java.version")).append("\",\n");
        sb.append("  \"capturedAt\": \"2026-09-05\",\n");
        sb.append("  \"seed\": \"n/a \\u2014 pure string/long functions\",\n");
        sb.append("  \"cases\": [\n");

        List<String> strings = new ArrayList<>();
        strings.add("");
        strings.add("a");
        strings.add("TerraFirmaCraft");
        strings.add("my cool seed");
        strings.add("12345");
        strings.add("-12345");
        strings.add("0");
        strings.add("-0");
        strings.add("9223372036854775807");   // Long.MAX_VALUE
        strings.add("-9223372036854775808");  // Long.MIN_VALUE
        strings.add("9223372036854775808");   // overflow by 1 -> hashCode fallback
        strings.add("99999999999999999999");  // way overflow -> hashCode fallback
        strings.add("+123");                  // Long.parseLong accepts a leading '+' (since Java 7)
        strings.add("12.5");
        strings.add(" 123");
        strings.add("123 ");
        strings.add("tfg:cluster_vein");
        strings.add("éèê");     // non-ASCII, exercises UTF-16 code units
        strings.add("😀");            // surrogate pair (an emoji), exercises per-code-unit hashing

        boolean first = true;
        for (String s : strings) {
            if (!first) sb.append(",\n");
            first = false;
            int hash = s.hashCode();
            String parsed;
            try {
                parsed = String.valueOf(Long.parseLong(s));
            } catch (NumberFormatException e) {
                parsed = null;
            }
            sb.append("    { \"input\": ").append(jsonString(s))
                    .append(", \"hashCode\": ").append(hash)
                    .append(", \"parsesAsLong\": ").append(parsed == null ? "null" : ("\"" + parsed + "\""))
                    .append(" }");
        }

        sb.append("\n  ]\n}\n");
        Files.write(Paths.get(args.length > 0 ? args[0] : "seed.json"), sb.toString().getBytes("UTF-8"));
        System.out.println("wrote " + sb.length() + " bytes");
    }

    static String jsonString(String s) {
        StringBuilder out = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': out.append("\\\""); break;
                case '\\': out.append("\\\\"); break;
                default:
                    if (c < 0x20 || c > 0x7e) {
                        out.append(String.format("\\u%04x", (int) c));
                    } else {
                        out.append(c);
                    }
            }
        }
        out.append("\"");
        return out.toString();
    }
}
