# Parity fixtures

Golden values captured from the real Java implementation. Layout:

```
tests/fixtures/<profile>/<component>.json
```

Every file must record its provenance:

```json
{
  "source": "net.dries007.tfc.world.… — method, mod version",
  "capturedAt": "YYYY-MM-DD",
  "seed": "…",
  "cases": [{ "in": [...], "out": ... }]
}
```

A fixture without provenance is not a fixture.
