/**
 * Canvas colours come from resolved theme tokens and nowhere else (ADR 0005, AGENTS.md section 6).
 *
 * `painter.ts` and `raster-layers.ts` each carried a hex copy of a token's value as its fallback --
 * 21 of them -- so the copies drifted the moment base.css retuned a token, and a canvas
 * that fell back ignored the theme. The page resolves every token base.css declares
 * (`resolveThemeTokens` in `src/ui/theme/theme.ts`), so a token is absent only where no stylesheet
 * ran: a unit test, or a tile worker before its first palette. Nothing here invents a colour for
 * that case. An absent token reads as `TOKEN_ABSENT`, the packed value zero, the same everywhere.
 *
 * Pure and allocation-free, so the raster layers can call it from a worker.
 */
export type TokenPalette = Readonly<Record<string, number>>;

/** What an absent token reads as: zero, not a guess at what the theme would have said. */
export const TOKEN_ABSENT = 0;

/** The packed 0xRRGGBB value of a theme token, or `TOKEN_ABSENT` when the palette lacks it. */
export function tokenColour(palette: TokenPalette, name: string): number {
  return palette[name] ?? TOKEN_ABSENT;
}
