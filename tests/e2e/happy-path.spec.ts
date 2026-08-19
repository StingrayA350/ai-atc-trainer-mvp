import { expect, test } from "@playwright/test";

const phrases = [
  "Seletar Ground, 9 Victor Bravo Charlie Alpha, Cessna 172 at stand Charlie Six, request taxi runway two one.",
  "Taxi via Whiskey Papa to holding point Whiskey One, hold short of runway two one, 9 Victor Bravo Charlie Alpha.",
  "One one eight decimal four five, 9 Victor Bravo Charlie Alpha.",
  "Seletar Tower, 9 Victor Bravo Charlie Alpha, holding short at Whiskey One, runway two one, ready for departure.",
  "Line up and wait runway two one, 9 Victor Bravo Charlie Alpha.",
  "Cleared for takeoff runway two one, 9 Victor Bravo Charlie Alpha.",
];

test("completes the full parking-to-airborne training journey", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Contact Ground when you’re ready to taxi." })).toBeVisible();
  await page.getByText("Prototype text test console").click();
  const textarea = page.getByPlaceholder("Type a learner transmission…");

  for (const [index, phrase] of phrases.entries()) {
    await textarea.fill(phrase);
    await page.getByRole("button", { name: "Transmit text" }).click();
    await expect(page.getByText("Readback accepted.")).toBeVisible();
    if (index === 1 || index === 4 || index === 5) {
      await expect(page.getByRole("button", { name: "Transmit text" })).toBeEnabled({ timeout: 12_000 });
    }
  }

  await expect(page.getByRole("heading", { name: /Nicely flown/ })).toBeVisible({ timeout: 12_000 });
  await expect(page.getByText("100%", { exact: true })).toBeVisible();
});

test("sends only one say-again request for rapid repeat clicks", async ({ page }) => {
  let sayAgainRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/say-again")) sayAgainRequests += 1;
  });

  await page.goto("/");
  await page.getByText("Prototype text test console").click();
  await page.getByPlaceholder("Type a learner transmission…").fill(phrases[0]);
  await page.getByRole("button", { name: "Transmit text" }).click();
  await expect(page.getByText("Readback accepted.")).toBeVisible();

  await page.getByRole("button", { name: "Say again" }).evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });

  await expect.poll(() => sayAgainRequests).toBe(1);
  await expect(page.getByText("The exercise updated at the same moment. Please try again.")).toHaveCount(0);
});
