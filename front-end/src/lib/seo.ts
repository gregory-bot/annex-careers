import { useEffect } from "react";

/**
 * Sets the document title, description, Open Graph / Twitter tags, canonical
 * link and optional JSON-LD for the current page, and restores the defaults
 * from index.html when the page unmounts.
 *
 * This is for browsers and JavaScript-rendering crawlers (Google). Chat and
 * social crawlers do not run JavaScript; for them, job links are served by
 * the backend's /share/jobs/{id} page via the web server (see deploy/).
 */
export const SITE_NAME = "Annex Careers";
export const OG_IMAGE_PATH = "/og-image.jpg";

export interface DocumentMeta {
  title: string;
  description?: string;
  /** Absolute URL of the page; defaults to the current location without query/hash. */
  url?: string;
  image?: string;
  type?: "website" | "article";
  jsonLd?: Record<string, unknown> | null;
}

type Selector = { attr: "name" | "property"; key: string };

const MANAGED: Selector[] = [
  { attr: "name", key: "description" },
  { attr: "property", key: "og:title" },
  { attr: "property", key: "og:description" },
  { attr: "property", key: "og:url" },
  { attr: "property", key: "og:image" },
  { attr: "property", key: "og:image:secure_url" },
  { attr: "property", key: "og:type" },
  { attr: "name", key: "twitter:title" },
  { attr: "name", key: "twitter:description" },
  { attr: "name", key: "twitter:image" },
];

const JSONLD_ID = "page-jsonld";

function findMeta(sel: Selector): HTMLMetaElement | null {
  return document.head.querySelector<HTMLMetaElement>(`meta[${sel.attr}="${sel.key}"]`);
}

function setMeta(sel: Selector, content: string) {
  let tag = findMeta(sel);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(sel.attr, sel.key);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

function setCanonical(href: string) {
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "canonical";
    document.head.appendChild(link);
  }
  link.href = href;
}

function setJsonLd(data: Record<string, unknown> | null | undefined) {
  const existing = document.getElementById(JSONLD_ID);
  if (!data) {
    existing?.remove();
    return;
  }
  const script = existing ?? Object.assign(document.createElement("script"), { id: JSONLD_ID, type: "application/ld+json" });
  script.textContent = JSON.stringify(data).replace(/<\//g, "<\\/");
  if (!existing) document.head.appendChild(script);
}

export function useDocumentMeta(meta: DocumentMeta | null) {
  useEffect(() => {
    if (!meta || typeof document === "undefined") return;

    // Snapshot what index.html shipped so we can put it back on unmount.
    const previousTitle = document.title;
    const previous = MANAGED.map((sel) => [sel, findMeta(sel)?.getAttribute("content") ?? null] as const);
    const previousCanonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null;

    const origin = window.location.origin;
    const url = meta.url ?? `${origin}${window.location.pathname}`;
    const image = meta.image ?? `${origin}${OG_IMAGE_PATH}`;
    const fullTitle = meta.title.includes(SITE_NAME) ? meta.title : `${meta.title} | ${SITE_NAME}`;
    const description = meta.description ?? previous.find(([sel]) => sel.key === "description")?.[1] ?? "";

    document.title = fullTitle;
    setMeta({ attr: "name", key: "description" }, description);
    setMeta({ attr: "property", key: "og:title" }, meta.title);
    setMeta({ attr: "property", key: "og:description" }, description);
    setMeta({ attr: "property", key: "og:url" }, url);
    setMeta({ attr: "property", key: "og:image" }, image);
    setMeta({ attr: "property", key: "og:image:secure_url" }, image);
    setMeta({ attr: "property", key: "og:type" }, meta.type ?? "website");
    setMeta({ attr: "name", key: "twitter:title" }, meta.title);
    setMeta({ attr: "name", key: "twitter:description" }, description);
    setMeta({ attr: "name", key: "twitter:image" }, image);
    setCanonical(url);
    setJsonLd(meta.jsonLd);

    return () => {
      document.title = previousTitle;
      for (const [sel, content] of previous) {
        if (content !== null) setMeta(sel, content);
        else findMeta(sel)?.remove();
      }
      if (previousCanonical) setCanonical(previousCanonical);
      setJsonLd(null);
    };
    // Re-run when any displayed value changes; jsonLd is compared by content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta?.title, meta?.description, meta?.url, meta?.image, meta?.type, JSON.stringify(meta?.jsonLd ?? null)]);
}

/** Plain-text, whitespace-collapsed excerpt for descriptions. */
export function excerpt(text: string | null | undefined, limit = 200): string {
  const plain = (text ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (plain.length <= limit) return plain;
  const cut = plain.slice(0, limit).replace(/\s+\S*$/, "");
  return `${cut.replace(/[,.;:]+$/, "")}\u2026`;
}
