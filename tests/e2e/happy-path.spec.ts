import { expect, test } from "@playwright/test";

const phrases = [
  "Seletar Ground, 9 Victor Bravo Charlie Alpha, Cessna one seven two at stand Charlie Six, request taxi runway two one.",
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
    await expect(page.getByText("Nice work — readback accepted.")).toBeVisible();
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
  await expect(page.getByText("Nice work — readback accepted.")).toBeVisible();

  await page.getByRole("button", { name: "Say again" }).evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });

  await expect.poll(() => sayAgainRequests).toBe(1);
  await expect(page.getByText("The exercise updated at the same moment. Please try again.")).toHaveCount(0);
});

test("uploads mobile audio and plays the delayed controller reply after release", async ({ page }) => {
  let session: Record<string, unknown> | undefined;
  let uploadedBody = "";

  await page.addInitScript(() => {
    const track = { stop() {} };
    const audioTest = { resumeCalls: 0, sourceStarts: 0 };
    Object.defineProperty(window, "__controllerAudioTest", { configurable: true, value: audioTest });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [track] }) },
    });

    class FakeMediaRecorder {
      static isTypeSupported(mimeType: string) {
        return mimeType.startsWith("audio/mp4");
      }

      state: RecordingState = "inactive";
      mimeType = "audio/mp4;codecs=mp4a.40.2";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;

      start() {
        this.state = "recording";
      }

      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["recorded audio"], { type: this.mimeType }) });
        this.onstop?.();
      }
    }

    class FakeAudioContext {
      state: AudioContextState = "suspended";
      destination = {};

      resume() {
        audioTest.resumeCalls += 1;
        this.state = "running";
        return Promise.resolve();
      }

      close() {
        this.state = "closed";
        return Promise.resolve();
      }

      createAnalyser() {
        return {
          fftSize: 512,
          getByteTimeDomainData(samples: Uint8Array) { samples.fill(128); },
        };
      }

      createMediaStreamSource() {
        return { connect() {} };
      }

      decodeAudioData() {
        return Promise.resolve({});
      }

      createBufferSource() {
        const source = {
          buffer: null,
          playbackRate: { value: 1 },
          onended: null as (() => void) | null,
          connect() {},
          stop() {},
          start() {
            audioTest.sourceStarts += 1;
            queueMicrotask(() => source.onended?.());
          },
        };
        return source;
      }
    }

    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: FakeMediaRecorder });
    Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeAudioContext });
  });

  await page.route(/\/api\/sessions$/, async (route) => {
    const response = await route.fetch();
    const body = await response.json() as { session: Record<string, unknown> };
    session = { ...body.session, provider: "OPENAI" };
    await route.fulfill({ response, json: { ...body, session } });
  });
  await page.route("**/api/sessions/*/transmissions", async (route) => {
    uploadedBody = route.request().postDataBuffer()?.toString("utf8") ?? "";
    await new Promise((resolve) => setTimeout(resolve, 50));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        session,
        transcript: phrases[0],
        validation: { status: "ACCEPTED", fieldResults: [] },
        controllerReply: {
          text: "Taxi to holding point Whiskey One.",
          audioDataUrl: "data:audio/mpeg;base64,AAAA",
          playbackRate: 1,
        },
      },
    });
  });

  await page.goto("/");
  const pushToTalk = page.getByRole("button", { name: "Hold to talk" });
  await pushToTalk.dispatchEvent("pointerdown", {
    pointerId: 7,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: 100,
    clientY: 100,
  });
  await expect(page.getByRole("button", { name: "Release to send" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    window as unknown as Window & { __controllerAudioTest: { resumeCalls: number } }
  ).__controllerAudioTest.resumeCalls)).toBeGreaterThan(0);
  await page.locator("body").dispatchEvent("pointerup", {
    pointerId: 7,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: 110,
    clientY: 105,
  });

  await expect.poll(() => uploadedBody).toContain('filename="transmission.mp4"');
  expect(uploadedBody).toContain("Content-Type: audio/mp4;codecs=mp4a.40.2");
  await expect.poll(() => page.evaluate(() => (
    window as unknown as Window & { __controllerAudioTest: { sourceStarts: number } }
  ).__controllerAudioTest.sourceStarts)).toBe(1);
});
