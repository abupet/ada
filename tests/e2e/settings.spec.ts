import { test, expect } from "./helpers/test-base";
import { login } from "./helpers/login";

test("@smoke Impostazioni: informazioni clinica visibili", async ({ page }) => {
  await login(page);

  await page.locator('.nav-item[data-page="settings"]').click();
  await expect(page.locator("#page-settings")).toBeVisible();

  await expect(page.locator("#vetNameInput")).toBeVisible();
  await expect(page.getByTestId("toggle-clinic-logo-section-button")).toBeVisible();
  await page.getByTestId("toggle-clinic-logo-section-button").click();
  await expect(page.getByTestId("clinic-logo-section-body")).toBeVisible();
  await expect(page.getByTestId("clinic-logo-preview")).toBeVisible();
  await expect(page.getByTestId("clinic-logo-upload-button")).toBeVisible();
  await expect(page.getByTestId("reset-clinic-logo-button")).toBeVisible();
  await expect(page.getByTestId("toggle-speakers-section-button")).toBeVisible();
});
// end
