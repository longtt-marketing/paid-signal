import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const publicDir = resolve(fileURLToPath(new URL("../public/", import.meta.url)));
const routes = new Map([["/", "index.html"], ["/judge", "judge.html"], ["/audit", "audit.html"]]);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".csv": "text/csv" };
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const target = resolve(publicDir, routes.get(pathname) || `.${decodeURIComponent(pathname)}`);
  if (target !== publicDir && !target.startsWith(`${publicDir}${sep}`)) { response.writeHead(403).end(); return; }
  try {
    const body = await readFile(target);
    response.writeHead(200, { "content-type": types[extname(target)] || "application/octet-stream" }).end(body);
  } catch { response.writeHead(404).end("Not found"); }
});

await new Promise((resolveListen, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolveListen);
});
const address = server.address();
let browser;
try {
  browser = process.env.PS_CDP_URL
    ? await chromium.connectOverCDP(process.env.PS_CDP_URL)
    : await chromium.launch({ channel: process.env.PS_BROWSER_CHANNEL || "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await page.route("https://**/*", (route) => route.abort());
  for (const path of routes.keys()) {
    await page.goto(`http://127.0.0.1:${address.port}${path}`, { waitUntil: "domcontentloaded" });
    if (path === "/") await page.waitForSelector(".hero-actions");
    await page.waitForTimeout(200);
    const width = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.clientWidth, page: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) }));
    assert.ok(width.page <= width.content, `${path} scrolls horizontally at 375 px: ${width.page} > ${width.content}`);
    console.log(`${path}: no horizontal scroll (${width.page}px document, ${width.viewport}px viewport)`);
  }
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
