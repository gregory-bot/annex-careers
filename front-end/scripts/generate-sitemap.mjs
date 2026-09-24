// Runs after `vite build`: copies the backend's live sitemap into dist/ so it is
// served from careers.annex-technologies.com/sitemap.xml (Search Console only
// accepts sitemaps on the verified domain). Never fails the build: if the API
// is unreachable, the main pages are written instead.
import { writeFileSync } from "node:fs";

const API = (process.env.VITE_API_URL ?? "https://annex-careers.onrender.com").replace(/\/+$/, "");
const SITE = "https://careers.annex-technologies.com";
const OUT = new URL("../dist/sitemap.xml", import.meta.url);
const FALLBACK_PATHS = ["/", "/jobs", "/contracts", "/companies", "/locations", "/categories", "/about", "/contact", "/privacy", "/terms"];

async function fetchLive() {
  // Render free instances can take a while to wake up.
  const res = await fetch(`${API}/sitemap.xml`, { signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  if (!xml.includes("<urlset")) throw new Error("response is not a sitemap");
  return xml;
}

try {
  const xml = await fetchLive();
  writeFileSync(OUT, xml);
  console.log(`sitemap.xml: ${(xml.match(/<loc>/g) ?? []).length} URLs from ${API}`);
} catch (err) {
  const urls = FALLBACK_PATHS.map((p) => `<url><loc>${SITE}${p}</loc></url>`).join("\n");
  writeFileSync(OUT, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  console.warn(`sitemap.xml: API unavailable (${err.message}); wrote ${FALLBACK_PATHS.length} main pages only`);
}
