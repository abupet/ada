import { test as base, expect } from "@playwright/test";
import { blockOpenAI } from "./block-openai";
import { applyStrictNetwork } from "./strict-network";

/**
 * Test base per smoke/regression/local:
 * - Se STRICT_NETWORK=1: blocca rete esterna non allowlisted
 * - Se ALLOW_OPENAI!=1: mock/blocco OpenAI
 */
export const test = base.extend({});

test.beforeEach(async ({ page }) => {
  // 1) STRICT first: block unknown external calls early
  await applyStrictNetwork(page);

  // 2) OpenAI mock (unless ALLOW_OPENAI=1)
  await blockOpenAI(page);
});

export { expect };
