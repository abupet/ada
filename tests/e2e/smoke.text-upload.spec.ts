import { test, expect } from "./helpers/test-base";
import { login } from "./helpers/login";
import { Fixtures } from "./helpers/fixtures";
import { captureHardErrors } from "./helpers/console";

test("@smoke Upload testo lungo (fixture)", async ({ page }) => {
  const errors = captureHardErrors(page);

  await login(page);

  // Input reale dell'app (hidden)
  const input = page.locator("#textFileInput");
  await expect(input).toHaveCount(1);

  await input.setInputFiles(Fixtures.longText);

  // Segnale robusto: toast “File testo caricato”
  await expect(page.locator("#toast")).toContainText("File testo caricato", { timeout: 10_000 });

  expect(errors, errors.join("\n")).toHaveLength(0);
});
