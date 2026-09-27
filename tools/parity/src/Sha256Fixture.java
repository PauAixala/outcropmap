import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;

/**
 * Dumps golden digests from the real JDK java.security.MessageDigest("SHA-256") for
 * tests/fixtures/core/sha256.json. Not shipped; source committed, output gitignored.
 */
public class Sha256Fixture {
    public static void main(String[] args) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        StringBuilder sb = new StringBuilder();
        sb.append("{\n");
        sb.append("  \"source\": \"java.security.MessageDigest.getInstance(\\\"SHA-256\\\") \\u2014 real JDK ")
                .append(System.getProperty("java.version")).append("\",\n");
        sb.append("  \"capturedAt\": \"2026-09-05\",\n");
        sb.append("  \"seed\": \"n/a \\u2014 pure hash function\",\n");
        sb.append("  \"cases\": [\n");

        List<String> inputs = new ArrayList<>();
        inputs.add("");
        inputs.add("abc");
        inputs.add("TerraFirmaCraft");
        inputs.add("minecraft:ore_vein");
        inputs.add("The quick brown fox jumps over the lazy dog");
        inputs.add("a".repeat(1000));

        boolean first = true;
        for (String s : inputs) {
            if (!first) sb.append(",\n");
            first = false;
            byte[] digest = md.digest(s.getBytes(StandardCharsets.UTF_8));
            sb.append("    { \"input\": ").append(jsonString(s)).append(", \"sha256Hex\": \"").append(toHex(digest)).append("\" }");
            md.reset();
        }

        sb.append("\n  ]\n}\n");
        Files.write(Paths.get(args.length > 0 ? args[0] : "sha256.json"), sb.toString().getBytes("UTF-8"));
        System.out.println("wrote " + sb.length() + " bytes");
    }

    static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
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
