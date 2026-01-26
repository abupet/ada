// policy-checks.js v2
const fs = require("fs");
const path = require("path");

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".git", "playwright-report", "test-results", "dist"].includes(entry.name)) continue;
      out.push(...walk(p));
    } else out.push(p);
  }
  return out;
}

const root = process.cwd();
const files = walk(root);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
const normalize = (p) => path.resolve(p).replace(/\\/g, "/");
const isWorkflowFile = (f) => normalize(f).includes("/.github/workflows/");

// ─────────────────────────────────────────────────────────────────────────────
// POL-01 Release notes cumulativo
const forbiddenRN = files.filter(f => {
  const b = path.basename(f);
  return /RELEASE[_-]?NOTES/i.test(b) && b !== "RELEASE_NOTES.md";
});
if (forbiddenRN.length) {
  console.error("❌ Forbidden release notes files:\n" + forbiddenRN.join("\n"));
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// POL-03 No secrets nel repo (heuristic)
// NOTE: Workflow files commonly contain references like ${{ secrets.OPENAI_API_KEY }}.
// We intentionally exclude .github/workflows/** from secret scanning to avoid false positives.
const secretPatterns = [
  /OPENAI[_-]?API[_-]?KEY/i,
  /BEARER\s+[A-Za-z0-9\-_\.]+/i,
  /sk-[A-Za-z0-9]{20,}/, // common key prefix pattern (generic)
  /-----BEGIN(.*?)PRIVATE KEY-----/i,
  /password\s*=\s*["'][^"']{6,}["']/i,
];

const scanExt = new Set([".js", ".ts", ".json", ".md", ".html", ".yml", ".yaml"]);
const secretHits = [];

// Exclude this policy checker file itself to avoid self-flagging
const thisFileAbs = path.resolve(__filename);
const thisFileNorm = normalize(thisFileAbs);

for (const f of files) {
  const ext = path.extname(f).toLowerCase();
  if (!scanExt.has(ext)) continue;

  // Skip this file itself (prevents self-flagging due to patterns like sk-...)
  if (normalize(f) === thisFileNorm) continue;

  // Skip workflows to avoid false positives on ${{ secrets.* }} usage
  if (isWorkflowFile(f)) continue;

  const b = path.basename(f);
  if (b === "package-lock.json") continue; // noisy

  const txt = fs.readFileSync(f, "utf8");
  for (const rx of secretPatterns) {
    if (rx.test(txt)) {
      secretHits.push(f);
      break;
    }
  }
}
if (secretHits.length) {
  console.error("❌ Potential secrets detected in:\n" + secretHits.join("\n"));
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// POL-04 DEPLOY_URL must be directory URL (ending with /)
// Enforce in workflow files (if present)
const workflowFiles = files.filter(f => f.includes(`${path.sep}.github${path.sep}workflows${path.sep}`));
const deployUrlBad = [];
for (const f of workflowFiles) {
  const txt = fs.readFileSync(f, "utf8");
  // if DEPLOY_URL is hardcoded, it must end with /
  const hardcoded = txt.match(/DEPLOY_URL:\s*["']?(https?:\/\/[^\s"']+)["']?/g) || [];
  for (const m of hardcoded) {
    const url = m.split(":").slice(1).join(":").trim().replace(/^["']|["']$/g, "");
    if (url.includes("index.html") || !url.endsWith("/")) deployUrlBad.push(`${f} -> ${url}`);
  }
}
if (deployUrlBad.length) {
  console.error("❌ DEPLOY_URL must be a directory URL ending with '/'. Found:\n" + deployUrlBad.join("\n"));
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// POL-02 No WebM/MP4 byte slicing (contextual)
const IGNORE_TAG = "POLICY-IGNORE:WEBM_BYTE_SLICE";
const jsFiles = files.filter(f =>
  (f.endsWith(".js") || f.endsWith(".ts")) &&
  !f.includes(`${path.sep}tests${path.sep}`) &&
  !f.includes(`${path.sep}.github${path.sep}`)
);

const windowLines = 25;
const nearLines = 8;

const sliceLine = (s) => /\.slice\s*\(/.test(s);
const blobSliceLine = (s) =>
  /\b(blob|record(ed)?Blob|mediaBlob|audioBlob)\b.*\.slice\s*\(/i.test(s) || /\bBlob\b.*\.slice\s*\(/i.test(s);
const webmLine = (s) => /\.(webm|mp4)\b/i.test(s) || /audio\/webm|video\/mp4/i.test(s);
const bufferSignalLine = (s) =>
  /\b(FileReader|readAsArrayBuffer|ArrayBuffer|Uint8Array|DataView|Content-Range|Range:|startByte|endByte)\b/i.test(s);

function extractContext(lines, idx, radius = 3) {
  const start = Math.max(0, idx - radius);
  const end = Math.min(lines.length, idx + radius + 1);
  return lines
    .slice(start, end)
    .map((l, i) => `${String(start + i + 1).padStart(4, " ")} | ${l}`)
    .join("\n");
}

const hits = [];

for (const f of jsFiles) {
  const content = fs.readFileSync(f, "utf8");
  if (content.includes(IGNORE_TAG)) continue;

  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!sliceLine(line)) continue;

    const startA = Math.max(0, i - nearLines);
    const endA = Math.min(lines.length - 1, i + nearLines);
    let hasWebmNearby = false;
    for (let j = startA; j <= endA; j++) {
      if (webmLine(lines[j])) { hasWebmNearby = true; break; }
    }
    if (!hasWebmNearby) continue;

    const startB = Math.max(0, i - windowLines);
    const endB = Math.min(lines.length - 1, i + windowLines);
    let hasBufferSignalNearby = false;
    for (let j = startB; j <= endB; j++) {
      if (bufferSignalLine(lines[j])) { hasBufferSignalNearby = true; break; }
    }
    if (!hasBufferSignalNearby) continue;

    const strength = blobSliceLine(line) ? "strong" : "weak";
    hits.push({ file: f, line: i + 1, strength, context: extractContext(lines, i, 4) });
  }
}

if (hits.length) {
  console.error("❌ Potential WebM/MP4 BYTE slicing (contextual) detected:\n");
  for (const h of hits) {
    console.error(`- ${h.file}:${h.line} (${h.strength})`);
    console.error(h.context);
    console.error("");
  }
  console.error(`If false positive, add: // ${IGNORE_TAG}`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// POL-05 Tag enforcement: @long must not run in standard PR CI workflows
// Allow @long in non-PR workflows (e.g. nightly/dispatch REAL).
const longBad = [];
for (const f of workflowFiles) {
  const txt = fs.readFileSync(f, "utf8");
  const isPRWorkflow = /\bon:\s*[\s\S]*\bpull_request\s*:/m.test(txt) || /\bpull_request\s*:/m.test(txt);
  const hasLong = /test:long|--grep\s+@long/i.test(txt);
  if (isPRWorkflow && hasLong) longBad.push(f);
}
if (longBad.length) {
  console.error("❌ @long tests must not run in PR CI workflows. Found in:\n" + longBad.join("\n"));
  process.exit(1);
}

console.log("✅ Policy checks passed");
