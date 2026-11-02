import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const publicDir = resolve(fileURLToPath(new URL("../public/", import.meta.url)));
const routes = new Map([["/", "index.html"], ["/judge", "judge.html"], ["/audit", "audit.html"]]);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".csv": "text/csv" };
// Local-only layout fixtures let the dashboard render without calling the live Worker.
const ads = [
  { ad: "trial_video", spend_cents: 9800, leads: 31, paid: 1, held: 0, disputed: 0, revenue_cents: 4900, net_cents: -4900, cost_per_paid_cents: 9800 },
  { ad: "free_guide", spend_cents: 7600, leads: 22, paid: 2, held: 0, disputed: 0, revenue_cents: 9800, net_cents: 2200, cost_per_paid_cents: 3800 },
  { ad: "parent_carousel", spend_cents: 5400, leads: 11, paid: 3, held: 0, disputed: 0, revenue_cents: 14700, net_cents: 9300, cost_per_paid_cents: 1800 },
  { ad: "holiday_static", spend_cents: 3900, leads: 8, paid: 1, held: 0, disputed: 0, revenue_cents: 4900, net_cents: 1000, cost_per_paid_cents: 3900 },
];
const totals = ads.reduce((sum, ad) => ({
  leads: sum.leads + ad.leads, paid: sum.paid + ad.paid, spend_cents: sum.spend_cents + ad.spend_cents,
  revenue_cents: sum.revenue_cents + ad.revenue_cents, net_cents: sum.net_cents + ad.net_cents, held: sum.held + ad.held,
}), { leads: 0, paid: 0, spend_cents: 0, revenue_cents: 0, net_cents: 0, held: 0 });
const payments = Array.from({ length: 18 }, (_, i) => ({
  capture_id: `MOBILE-CAP-${String(i + 1).padStart(2, "0")}`, ad: ads[i % ads.length].ad, source: i % 3 ? "fb" : "g", click_id: "",
  amount: "49.00", currency: "USD", captured_at: `2026-10-${String(20 + (i % 10)).padStart(2, "0")}T12:00:00.000Z`,
  refunded_amount: i % 6 === 0 ? "10.00" : "0.00", status: i % 6 === 0 ? "PARTIALLY_REFUNDED" : "COMPLETED",
}));
const invoices = Array.from({ length: 24 }, (_, i) => ({
  id: `INV2-MOBILE-${String(i + 1).padStart(2, "0")}`, lead: `Demo lead ${String(i + 1).padStart(2, "0")}`, ad: ads[i % ads.length].ad,
  amount: "49.00", status: i % 4 === 0 ? "SENT" : "DRAFT", created_at: `2026-10-${String(20 + (i % 10)).padStart(2, "0")}T10:00:00.000Z`,
  ...(i % 4 === 0 ? { sent_at: `2026-10-${String(20 + (i % 10)).padStart(2, "0")}T11:00:00.000Z`, pay_url: "https://example.test/invoice" } : {}),
  lines: [{ name: "Robotics trial class" }],
}));
const apiFixture = (path) => {
  if (path === "/api/config") return { environment: "sandbox", ag_studio_license: null };
  if (path === "/api/reconcile") return { reconciliation: { totals, ads }, odds: { ads: Object.fromEntries(ads.map((ad) => [ad.ad, { chance_covers_spend: 0.56, more_spend_to_decide_cents: 4900, verdict: "unclear" }])) }, csv_errors: [], meta: { events: [], held: [] }, google: { conversions: [], adjustments: [] } };
  if (path === "/api/ledger") return { payments, duplicates: [], meta: [], meta_live: false };
  if (path === "/api/invoices") return { invoices };
  if (path === "/api/invoices/sync") return { checked: 0, paid: 0, invoices };
  if (path === "/api/recommendation") return { latest: { id: "mobile-layout-fixture", at: "2026-11-02T08:00:00.000Z", source: "local mobile layout fixture", ms: 0,
    recommendation: { headline: "Keep the ad with the strongest paid evidence funded.", actions: [{ ad: "parent_carousel", change: "keep", reason: "This fixture keeps the recommendation visible on a phone.", evidence: [payments[2].capture_id] }] } }, mine: null, shared: null, decisions: [], decision_count: 0, my_decision_count: 0 };
  return undefined;
};
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
  await page.route("**/api/**", (route) => {
    const data = apiFixture(new URL(route.request().url()).pathname);
    return data === undefined ? route.continue() : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
  for (const path of routes.keys()) {
    await page.goto(`http://127.0.0.1:${address.port}${path}`, { waitUntil: "domcontentloaded" });
    if (path === "/") {
      await page.waitForSelector(".hero-actions");
      if (process.env.PS_EXPECT_AD_CARDS !== "0") {
        await page.waitForSelector(".ad-cards .ad-card");
        assert.equal(await page.locator(".ad-cards .ad-card").count(), ads.length, "all ad cards should render on mobile");
        assert.equal(await page.locator(".desktop-only").isVisible(), false, "the wide table should be hidden on mobile");
        assert.equal(await page.locator("#payments").getAttribute("open"), null, "Payments should start collapsed on mobile");
        assert.equal(await page.locator("#invoices").getAttribute("open"), null, "invoice history should start collapsed on mobile");
        assert.ok(await page.getByText("Keep the ad with the strongest paid evidence funded.").isVisible(), "the budget recommendation should stay open");
      } else {
        await page.waitForSelector(".grid tbody tr");
      }
    }
    await page.waitForTimeout(200);
    const width = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.clientWidth, page: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) }));
    assert.ok(width.page <= width.content, `${path} scrolls horizontally at 375 px: ${width.page} > ${width.content}`);
    console.log(`${path}: no horizontal scroll (${width.page}px document, ${width.viewport}px viewport); document height ${width.height}px`);
  }
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
