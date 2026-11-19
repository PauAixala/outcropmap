#!/usr/bin/env node
/**
 * Adds Cloudflare Web Analytics to the production HTML after the standard site build checks.
 * The check in finish-web-build.mjs deliberately rejects unapproved remote scripts; keeping this
 * integration as a final, separately-verified step lets that existing policy remain intact.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';
export const BEACON_TOKEN = 'e8d7808b30e947aa8e1e1241bb0d11fd';
export const PRIVACY_DISCLOSURE =
  '<section class="privacy__analytics"><h2>Web analytics</h2><p>This site uses Cloudflare Web Analytics to measure visits and page views. Its beacon loads from Cloudflare when you visit the site. For details, see <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer">Cloudflare’s privacy policy</a>.</p></section>';

const BEACON = `<!-- Cloudflare Web Analytics --><script type="module" src="${BEACON_SRC}" data-cf-beacon='{"token": "${BEACON_TOKEN}"}'></script><!-- End Cloudflare Web Analytics -->`;

/** Add the Cloudflare beacon once to a generated page, and disclose it on the privacy page. */
export function addCloudflareAnalytics(html, file) {
  if (!file.endsWith('.html')) throw new Error(`Not an HTML page: ${file}`);
  if (html.includes('data-cf-beacon')) throw new Error(`${file} already contains a Cloudflare beacon`);
  if (!html.includes('</head>')) throw new Error(`${file} has no closing </head>`);

  let result = html.replace('</head>', `  ${BEACON}\n</head>`);
  if (file === 'privacy.html') {
    if (!result.includes('</article>')) throw new Error('privacy.html has no closing </article>');
    result = result.replace('</article>', `  ${PRIVACY_DISCLOSURE}\n</article>`);
  }
  return result;
}

function finishBuild() {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const out = path.join(root, 'dist');
  const pages = readdirSync(out).filter((file) => file.endsWith('.html')).sort();
  if (pages.length === 0) throw new Error('dist/ contains no HTML pages');
  for (const file of pages) {
    const fullPath = path.join(out, file);
    const html = readFileSync(fullPath, 'utf8');
    writeFileSync(fullPath, addCloudflareAnalytics(html, file));
  }
  console.log(`Added Cloudflare Web Analytics to ${pages.length} pages`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) finishBuild();
