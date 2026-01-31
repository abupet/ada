import type { Page } from "@playwright/test";

export function captureHardErrors(page: Page) {
  const errors: string[] = [];

  // Uncaught exceptions in the page (real JS errors)
  page.on("pageerror", e => errors.push(String(e)));

  // Console errors: keep tests strict but ignore benign "missing static resource" noise,
  // which otherwise makes smoke tests flaky (e.g., favicon/asset 404 in CI).
  page.on("console", msg => {
    if (msg.type() !== "error") return;
    const text = msg.text() || "";

    // Example:
    // "Failed to load resource: the server responded with a status of 404 (Not Found)"
    if (/Failed to load resource:.*\b404\b.*Not Found/i.test(text)) return;

    errors.push(text);
  });

  return errors;
}
