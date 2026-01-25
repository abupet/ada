import type { Page, Route, Request } from "@playwright/test";

/**
 * STRICT_NETWORK=1:
 * - Blocca ogni richiesta verso host non in allowlist.
 * - Consente: localhost/127.0.0.1, abupet.github.io + github resources, e protocolli browser-safe.
 * - OpenAI:
 *    - consentita SOLO se ALLOW_OPENAI=1
 *
 * Extra allowlist: STRICT_ALLOW_HOSTS="a.com,b.com"
 */
export async function applyStrictNetwork(page: Page) {
  if (process.env.STRICT_NETWORK !== "1") return;

  const allowOpenAI = process.env.ALLOW_OPENAI === "1";

  const allowedHosts = new Set<string>([
    // Local
    "localhost",
    "127.0.0.1",
    "0.0.0.0",

    // GitHub Pages
    "abupet.github.io",
    "github.io",
    "www.github.io",

    // GitHub resources (if any)
    "raw.githubusercontent.com",
    "user-images.githubusercontent.com",
    "avatars.githubusercontent.com",
  ]);

  // Optional: allow extra hosts via env
  const extra = (process.env.STRICT_ALLOW_HOSTS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  for (const h of extra) allowedHosts.add(h);

  const allowedSchemes = new Set([
    "http:",
    "https:",
    "data:",
    "blob:",
    "about:",
    "file:",
  ]);

  function isAllowed(req: Request): boolean {
    const urlStr = req.url();

    // Internal Chrome extensions etc.
    if (urlStr.startsWith("chrome-extension://")) return true;

    let u: URL;
    try {
      u = new URL(urlStr);
    } catch {
      // If parsing fails, better to allow than to false-block
      return true;
    }

    if (!allowedSchemes.has(u.protocol)) return false;

    // Non-network schemes
    if (
      u.protocol === "data:" ||
      u.protocol === "blob:" ||
      u.protocol === "about:" ||
      u.protocol === "file:"
    ) {
      return true;
    }

    const host = u.hostname;

    // OpenAI allowed only if explicitly enabled
    if (host === "api.openai.com" || host.endsWith(".openai.com")) {
      return allowOpenAI;
    }

    if (allowedHosts.has(host)) return true;

    // Allow any subdomain of github.io (rare but can happen)
    if (host.endsWith(".github.io")) return true;

    return false;
  }

  // IMPORTANT: this must be the only global "**/*" route.
  await page.route("**/*", async (route: Route) => {
    const req = route.request();

    const allowed = isAllowed(req);
    if (!allowed) {
      // Log utile per capire quali host/CDN stai usando davvero.
      // Esempio output:
      // [STRICT_NETWORK] BLOCK GET script https://cdn.jsdelivr.net/npm/chart.js
      const method = req.method();
      const url = req.url();
      const type = req.resourceType();

      console.log(`[STRICT_NETWORK] BLOCK ${method} ${type} ${url}`);

      return route.abort("blockedbyclient");
    }

    // Navigation requests should be filtered too (già incluso in allowed)
    return route.continue();
  });
}
