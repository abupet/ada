import { test, expect } from "./helpers/test-base";
import { login } from "./helpers/login";
import { Fixtures } from "./helpers/fixtures";
import { captureHardErrors } from "./helpers/console";

test("Upload audio breve 20s (fixture) – regression", async ({ page }) => {
  const errors = captureHardErrors(page);

  await login(page);

  const input = page.locator("#audioFileInput");
  await expect(input).toHaveCount(1);

  await input.setInputFiles(Fixtures.audio20s);

  const status = page.locator("#recordingStatus");
  await expect(status).toContainText("📁 File:", { timeout: 10_000 });
  await expect(status).toContainText("Neve visita_epilessia 20s.webm", { timeout: 10_000 });

  await expect(page.locator("#toast")).toContainText("File caricato", { timeout: 10_000 });

  expect(errors, errors.join("\n")).toHaveLength(0);
});
