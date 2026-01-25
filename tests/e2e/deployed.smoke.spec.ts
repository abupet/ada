
import { test, expect } from "@playwright/test";
import { blockOpenAI } from "./helpers/block-openai";
import { captureHardErrors } from "./helpers/console";
import { applyStrictNetwork } from "./helpers/strict-network";

test("@deployed Published app: carica + login + visita ok", async ({ page, context }) => {
  // STRICT_NETWORK=1: blocca rete non allowlisted (incl. OpenAI se ALLOW_OPENAI!=1)
  await applyStrictNetwork(page);

  // Mock OpenAI (unless ALLOW_OPENAI=1)
  await blockOpenAI(page);

  await context.clearCookies();
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
  });

  const errors = captureHardErrors(page);

  const pwd = process.env.ADA_TEST_PASSWORD;
  if (!pwd) throw new Error("Missing ADA_TEST_PASSWORD env var");

  await page.goto("index.html", { waitUntil: "domcontentloaded" });

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
  await expect(page.locator("#page-recording")).toBeVisible();

  const scripts = await page.evaluate(() =>
    Array.from(document.scripts).map(s => s.src).filter(Boolean)
  );
  expect(scripts.join("\n")).toContain("app-recording.js");

  expect(errors, errors.join("\n")).toHaveLength(0);
});
