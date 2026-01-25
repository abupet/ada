import type { Page } from "@playwright/test";

export function captureHardErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", msg => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}
