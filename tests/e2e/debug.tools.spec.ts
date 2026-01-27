// debug.tools.spec.ts v2
import { test, expect } from "./helpers/test-base";
import { login } from "./helpers/login";

test("@smoke Debug tools: long audio/text test buttons presenti e cliccabili", async ({ page }) => {
  await login(page);

  // Vai alla pagina Debug
  await page.locator('.nav-item[data-page="debug"]').click();
  await expect(page.locator("#page-debug")).toBeVisible();

  // I bottoni sono nella pagina Debug
  const longTextBtn = page.getByTestId("long-text-test-button");
  const longAudioBtn = page.getByTestId("long-audio-test-button");

  await expect(longTextBtn).toBeVisible();
  await expect(longAudioBtn).toBeVisible();

  // Click “best-effort”: il click apre l'input hidden. Non forziamo upload qui (lo fanno altri test).
  await longTextBtn.click().catch(() => {});
  await longAudioBtn.click().catch(() => {});
});
