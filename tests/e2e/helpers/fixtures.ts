import path from "path";

// in ambiente Playwright 1.58 il transform tende a CommonJS,
// quindi qui usiamo direttamente __dirname (che in CJS esiste).
// Se per qualche motivo __dirname non esistesse, fallback a process.cwd()
const here = typeof __dirname !== "undefined" ? __dirname : process.cwd();

// tests/e2e/helpers -> tests/fixtures
const fixturesRoot = path.resolve(here, "..", "..", "fixtures");

export const Fixtures = {
  audio20s: path.join(fixturesRoot, "audio", "Neve visita_epilessia 20s.webm"),
  audio100s: path.join(fixturesRoot, "audio", "Neve visita_epilessia 100s.webm"),
  audio40m: path.join(fixturesRoot, "audio", "Pet Anatomy 40m.webm"),
  longText: path.join(fixturesRoot, "text", "Neve Visita molto lunga.txt"),
};
