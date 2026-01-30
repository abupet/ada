/**
 * scripts/cache-bust.js
 * Auto-appends a cache-busting query param to local JS/CSS assets referenced by docs/index.html.
 *
 * Usage:
 *   node scripts/cache-bust.js --file docs/index.html --id <cacheBustId>
 *
 * If --id is omitted, it uses process.env.CACHE_BUST or falls back to current timestamp.
 */
const fs = require("fs");
const path = require("path");

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

const file = getArg("--file") || "docs/index.html";
const id =
  getArg("--id") ||
  process.env.CACHE_BUST ||
  String(Date.now());

const abs = path.resolve(process.cwd(), file);
let html = fs.readFileSync(abs, "utf8");

// Only rewrite local assets (no http/https/data/mailto).
function isLocalUrl(u) {
  return (
    typeof u === "string" &&
    u.length > 0 &&
    !u.startsWith("http://") &&
    !u.startsWith("https://") &&
    !u.startsWith("//") &&
    !u.startsWith("data:") &&
    !u.startsWith("mailto:")
  );
}

function withBust(url) {
  // Keep anchors, replace existing v=, otherwise add v=
  const [beforeHash, hash = ""] = url.split("#");
  const hasQuery = beforeHash.includes("?");
  const parts = beforeHash.split("?");
  const baseUrl = parts[0];
  const query = parts[1] || "";

  // If already has v=, replace it; else append.
  const params = new URLSearchParams(query);
  params.set("v", id);
  const newQuery = params.toString();
  const out = baseUrl + "?" + newQuery + (hash ? "#" + hash : "");
  return out;
}

// Replace in <script src="..."> and <link href="..."> for .js/.css
html = html.replace(/<script\b([^>]*?)\bsrc\s*=\s*["']([^"']+)["']([^>]*)><\/script>/gi, (m, pre, src, post) => {
  if (!isLocalUrl(src)) return m;
  if (!/\.(js)(\?|#|$)/i.test(src)) return m;
  const updated = withBust(src);
  return `<script${pre}src="${updated}"${post}></script>`;
});

html = html.replace(/<link\b([^>]*?)\bhref\s*=\s*["']([^"']+)["']([^>]*?)>/gi, (m, pre, href, post) => {
  if (!isLocalUrl(href)) return m;
  if (!/\.(css)(\?|#|$)/i.test(href)) return m;
  const updated = withBust(href);
  return `<link${pre}href="${updated}"${post}>`;
});

fs.writeFileSync(abs, html, "utf8");
console.log(`cache-bust: updated ${file} with v=${id}`);
