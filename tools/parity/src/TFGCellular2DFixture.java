import su.terrafirmagreg.core.world.new_ow_wg.noise.TFGCellular2D;
import java.util.Locale;

/** Captures values from the installed, version-pinned TFG 0.9.21 class. */
public final class TFGCellular2DFixture {
    private static void sample(String label, TFGCellular2D noise, double x, double y) {
        TFGCellular2D.TFGCell c = noise.cell(x, y);
        System.out.printf(
            "{\"label\":\"%s\",\"x\":%.17g,\"y\":%.17g,\"noise\":%.17g,\"cell\":{\"x\":%.17g,\"y\":%.17g,\"cx\":%d,\"cy\":%d,\"f1\":%.17g,\"f2\":%.17g,\"noise\":%.17g,\"angle\":%.17g}}%n",
            label, x, y, noise.noise(x, y), c.x(), c.y(), c.cx(), c.cy(), c.f1(), c.f2(), c.noise(), c.angle()
        );
    }

    public static void main(String[] args) {
        Locale.setDefault(Locale.ROOT);
        long seed = -6696614430994881185L;
        TFGCellular2D defaults = new TFGCellular2D(seed);
        sample("default-negative", defaults, -3.25, -1.75);
        sample("default-origin", defaults, 0.0, 0.0);
        sample("default-tie-near", defaults, 2.5, -2.5);

        TFGCellular2D sampleTwo = new TFGCellular2D(seed, 2);
        sample("sample-2-negative", sampleTwo, -3.25, -1.75);
        sample("sample-2-positive", sampleTwo, 4.125, 5.5);

        TFGCellular2D custom = new TFGCellular2D(42L, 0.25f, 2);
        custom.spread(0.125);
        sample("custom-jitter-spread", custom, -12345.678, 9876.543);

        TFGCellular2D explicitZero = new TFGCellular2D(42L, 0.0f, 1);
        sample("explicit-zero-jitter", explicitZero, -0.125, 0.25);
    }
}
