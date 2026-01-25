import { test, expect } from "./helpers/test-base";
import { login } from "./helpers/login";
import { captureHardErrors } from "./helpers/console";

test("@smoke Visita: nessun errore console + app-recording.js caricato", async ({ page }) => {
  const errors = captureHardErrors(page);

  await login(page);

  await expect(page.locator("#page-recording")).toBeVisible();

  const scripts = await page.evaluate(() =>
    Array.from(document.scripts).map(s => s.src).filter(Boolean)
  );
  expect(scripts.join("\n")).toContain("app-recording.js");

  expect(errors, errors.join("\n")).toHaveLength(0);
});
