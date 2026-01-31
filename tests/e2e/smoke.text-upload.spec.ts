// smoke.text-upload.spec.ts v3
import { test, expect } from "@playwright/test";
import { attachConsoleErrorCollector } from "./helpers/consoleErrors";
import path from "path";

test("@smoke Upload testo lungo (fixture)", async ({ page }) => {
  const { errors } = attachConsoleErrorCollector(page, {
    ignoreGeneric404: true,
  });

  await page.goto("/#/visit");

  // Upload a long text fixture (existing test expects this to work).
  // Keep paths compatible with Playwright running from repo root.
  const fixturePath = path.resolve(__dirname, "fixtures", "long-text.txt");

  await page.setInputFiles('input[type="file"]', fixturePath);

  await expect(page.locator("#toast")).toContainText("File testo caricato", { timeout: 10_000 });

  expect(errors, errors.join("\n")).toHaveLength(0);
});
