import { test, expect } from "./helpers/test-base";
import { login } from "./helpers/login";

test("@smoke Impostazioni: logo clinica visibile, API key in debug", async ({ page }) => {
  await login(page);

  await page.locator('.nav-item[data-page="settings"]').click();
  await expect(page.locator("#page-settings")).toBeVisible();

  await expect(page.getByTestId("clinic-logo-preview")).toBeVisible();
  await expect(page.getByTestId("clinic-logo-upload-button")).toBeVisible();
  await expect(page.getByTestId("reset-clinic-logo-button")).toBeVisible();

  await page.locator('.nav-item[data-page="debug"]').click();
  await expect(page.locator("#page-debug")).toBeVisible();
  await expect(page.getByTestId("api-key-mode-selector")).toBeVisible();
});
