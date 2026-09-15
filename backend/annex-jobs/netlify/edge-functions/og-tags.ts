import type { Context } from "https://edge.netlify.com";

const API_BASE = "https://jobs-data-pipeline.onrender.com";
const SITE_URL = "https://annex-careers.netlify.app";
const SITE_IMAGE = "https://i.pinimg.com/1200x/11/76/5e/11765ed3b9670d21f9ab4b84eb72d33d.jpg";

const BOT_UA = /Twitterbot|facebookexternalhit|LinkedInBot|Slackbot|WhatsApp|TelegramBot|Discordbot|Googlebot/i;

export default async function handler(request: Request, context: Context) {
  const ua = request.headers.get("user-agent") || "";

  // Only intercept for social media bots
  if (!BOT_UA.test(ua)) {
    return context.next();
  }

  const url = new URL(request.url);
  const match = url.pathname.match(/^\/jobs\/(\d+)$/);

  if (!match) {
    return context.next();
  }

  const jobId = match[1];

  try {
    const resp = await fetch(`${API_BASE}/api/jobs/${jobId}`, {
      headers: { "User-Agent": "Netlify-Edge-Function" },
    });

    if (!resp.ok) {
      return context.next();
    }

    const job = await resp.json();
    const title = job.title || "Job Opportunity";
    const company = job.company || "";
    const location = job.location || "";
    const description = (job.description || "").slice(0, 200).replace(/"/g, "&quot;");
    const pageTitle = company ? `${title} at ${company}` : title;
    const subtitle = [company, location].filter(Boolean).join(" · ");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${pageTitle} - Annex Careers</title>
  <meta name="description" content="${description}" />

  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="Annex Careers" />
  <meta property="og:title" content="${pageTitle}" />
  <meta property="og:description" content="${subtitle ? subtitle + " — " : ""}${description}" />
  <meta property="og:image" content="${SITE_IMAGE}" />
  <meta property="og:url" content="${SITE_URL}/jobs/${jobId}" />

  <meta name="twitter:card" content="summary" />
  <meta name="twitter:site" content="@gregorytechKE" />
  <meta name="twitter:title" content="${pageTitle}" />
  <meta name="twitter:description" content="${subtitle ? subtitle + " — " : ""}${description}" />
  <meta name="twitter:image" content="${SITE_IMAGE}" />
</head>
<body>
  <p>${pageTitle}</p>
  <p>${subtitle}</p>
  <p>${description}</p>
</body>
</html>`;

    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch {
    return context.next();
  }
}

export const config = {
  path: "/jobs/*",
};
