import { test, expect } from "./helpers/test-base";
import { login } from "./helpers/login";
import { Fixtures } from "./helpers/fixtures";
import { captureHardErrors } from "./helpers/console";

test("@long Upload audio molto lungo 40m (fixture) – manual only", async ({ page }) => {
  test.setTimeout(20 * 60_000);

  const errors = captureHardErrors(page);

  await login(page);

  const input = page.locator("#longAudioTestInput");
  await expect(input).toHaveCount(1);

  await input.setInputFiles(Fixtures.audio40m);

  // Verifica solo “non crash” + un segnale UI minimo
  await expect(page.locator("#toast")).toHaveText(/.+/, { timeout: 20_000 });

  expect(errors, errors.join("\n")).toHaveLength(0);
});
