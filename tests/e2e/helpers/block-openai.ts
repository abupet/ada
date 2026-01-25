import type { Page, Route } from "@playwright/test";

/**
 * Mock/blocco OpenAI per test automatici.
 * - Evita costi e flakiness
 * - Risposte compatibili con l'app (transcriptions, chat/completions, audio/speech)
 *
 * Disattiva i mock impostando:
 *   ALLOW_OPENAI=1
 *
 * IMPORTANT:
 * - Questa route deve matchare SOLO OpenAI, altrimenti bypassa STRICT_NETWORK.
 */
export async function blockOpenAI(page: Page) {
  if (process.env.ALLOW_OPENAI === "1") return;

  // Match ONLY OpenAI requests (no "**/*")
  await page.route("**://api.openai.com/**", async (route: Route) => {
    const url = route.request().url();

    // /v1/audio/transcriptions
    if (url.includes("/v1/audio/transcriptions")) {
      const body = {
        text: "[MOCK] Transcription OK",
        segments: [
          { id: 0, text: "[MOCK] Buongiorno, iniziamo la visita.", start: 0.0, end: 2.0, speaker: "vet" },
          { id: 1, text: "[MOCK] Neve ha avuto una crisi ieri.", start: 2.1, end: 4.4, speaker: "pet_parent" },
        ],
      };

      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    }

    // /v1/chat/completions
    if (url.includes("/v1/chat/completions")) {
      const body = {
        id: "chatcmpl_mock",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "mock",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "[MOCK] Risposta generata localmente (no chiamate esterne).",
            },
            finish_reason: "stop",
          },
        ],
      };

      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    }

    // /v1/audio/speech
    if (url.includes("/v1/audio/speech")) {
      const bytes = Buffer.from("MOCK_AUDIO_BYTES");
      return route.fulfill({
        status: 200,
        contentType: "audio/mpeg",
        body: bytes,
      });
    }

    // Any other OpenAI endpoint → generic mock
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, mocked: true, url }),
    });
  });
}
