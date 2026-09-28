# Pages

`map/` -> index.html, `forge/` -> forge.html, `about/` -> about.html, `privacy/` -> privacy.html.
All four share the shell, theme and storage; the ads, when `ads.config.json` switches them on, come
from `src/ui/components/ad-slot.ts`. `src/app/site/site.json` lists the pages for the build, the
header and the build check: a page must be listed there to be built.
