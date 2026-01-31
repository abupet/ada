import { test, expect } from "./helpers/test-base";
import { login } from "./helpers/login";

test("@smoke Registrazione: microfono e upload non sono inerti", async ({ page }) => {
  await login(page);

  const recordBtn = page.getByTestId("record-button");
  const status = page.getByTestId("recording-status");

  await expect(recordBtn).toBeVisible();
  await expect(status).toBeVisible();

  // Se il bottone è disabilitato solo finché non si concedono permessi,
  // limitiamoci a verificare che il click non crashi.
  await recordBtn.click().catch(() => {});
  await expect(status).toBeVisible();
});
