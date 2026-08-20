import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const handlerUrl = new URL("../.vercel/output/functions/__server.func/index.mjs", import.meta.url);
  handlerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: handler } = await import(handlerUrl.href);

  return handler.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { waitUntil() {} },
  );
}

test("server-renders the Seletar trainer shell and site metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>AI ATC Trainer/);
  assert.match(html, /Preparing Seletar departure/);
  assert.match(html, /Practice a chart-derived Cessna 172 departure/);
  assert.match(html, /http:\/\/localhost(?::3000)?\/og\.png/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships the site-specific social card and no starter preview", async () => {
  const [layout, page] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /generateMetadata/);
  assert.match(layout, /\/og\.png/);
  assert.match(page, /<TrainerApp \/>/);
  assert.doesNotMatch(`${layout}\n${page}`, /SkeletonPreview|codex-preview/);
  await access(new URL("../public/og.png", import.meta.url));
});
