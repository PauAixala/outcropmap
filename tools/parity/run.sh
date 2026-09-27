#!/usr/bin/env bash
# Regenerates every JDK-backed parity fixture under tests/fixtures/core/.
#
# Requires a JDK (not just a JRE) on PATH, or JAVA_HOME set to one. This project does not vendor a
# JDK — CI/dev machines are expected to have one, or you can download a Temurin build for local use
# and point JAVA_HOME at it; nothing under here is shipped (tools/parity/out/ is gitignored).
set -euo pipefail
cd "$(dirname "$0")"

JAVAC="javac"
JAVA="java"
if [ -n "${JAVA_HOME:-}" ]; then
  JAVAC="$JAVA_HOME/bin/javac"
  JAVA="$JAVA_HOME/bin/java"
fi

OUT_DIR="out"
FIXTURES_DIR="../../tests/fixtures/core"
mkdir -p "$OUT_DIR" "$FIXTURES_DIR"

"$JAVAC" -encoding UTF-8 -d "$OUT_DIR" src/JavaRandomFixture.java src/SeedFixture.java src/Sha256Fixture.java src/ImprovedNoiseFixture.java src/SimplexNoiseFixture.java

"$JAVA" -cp "$OUT_DIR" JavaRandomFixture "$FIXTURES_DIR/java-random.json"
"$JAVA" -cp "$OUT_DIR" SeedFixture "$FIXTURES_DIR/seed.json"
"$JAVA" -cp "$OUT_DIR" Sha256Fixture "$FIXTURES_DIR/sha256.json"
# Minecraft RNG fixtures require the official server bundle: see capture-minecraft.mjs.
"$JAVA" -cp "$OUT_DIR" ImprovedNoiseFixture "$FIXTURES_DIR/improved-noise.json"
"$JAVA" -cp "$OUT_DIR" SimplexNoiseFixture "$FIXTURES_DIR/simplex-noise.json"

echo "Fixtures written to $FIXTURES_DIR"
