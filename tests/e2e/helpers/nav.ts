import { expect, Page } from "@playwright/test";

export async function gotoApp(page: Page) {
  // IMPORTANT: baseURL is a directory, so use index.html (never "/")
  await page.goto("index.html", { waitUntil: "domcontentloaded" });
}

export async function gotoRecording(page: Page) {
  // Assumiamo che la pagina recording sia visibile di default post-login.
  await expect(page.locator("#page-recording")).toBeVisible();
}

export async function gotoSoap(page: Page) {
  // Se hai un bottone/tab, qui puoi renderlo più esplicito.
  // Per ora: se esiste l'elemento pagina, deve essere raggiungibile/visibile.
  // Se serve un click, dimmi l'id/data-testid e lo metto.
  await expect(page.locator("#page-soap")).toBeVisible();
}

export async function gotoSettings(page: Page) {
  await expect(page.locator("#page-settings")).toBeVisible();
}
