import { expect, Page } from "@playwright/test";
import { gotoApp } from "./nav";

export async function login(page: Page) {
  const pwd = process.env.ADA_TEST_PASSWORD;
  if (!pwd) throw new Error("Missing ADA_TEST_PASSWORD env var");

  await gotoApp(page);

  await expect(page.locator("#passwordInput")).toBeVisible();
  await expect(page.getByTestId("login-button")).toBeVisible();

  await page.locator("#passwordInput").fill(pwd);
  await page.getByTestId("login-button").click();

  const loginError = page.getByTestId("login-error");
  if (await loginError.isVisible().catch(() => false)) {
    const txt = await loginError.textContent();
    throw new Error(`Login failed (login-error visible): ${txt || ""}`);
  }

  await expect(page.locator("#appContainer")).toBeVisible();
}
