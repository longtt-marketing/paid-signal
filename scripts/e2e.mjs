// End-to-end check of the live demo in a real browser (run daily in CI): ad link -> shop -> PayPal order with the click
// in custom_id -> dashboard with the three custom widgets -> refund preview on a seeded payment -> MCP answers.
// Read-only for the ledger: it creates one sandbox order (never approved) and only previews a refund.
// Usage: node scripts/e2e.mjs   (needs `npm i -D playwright` and `npx playwright install chromium`)
import { chromium } from "playwright";

const BASE = process.env.BASE || "https://paid-signal.thelongmarketing.workers.dev";
const checks = [];
const ok = (name, cond, detail = "") => { checks.push({ name, pass: !!cond, detail }); console.log(`${cond ? "ok  " : "FAIL"} ${name} ${detail}`); };

const browser = await chromium.launch({ args: ["--mute-audio", "--no-first-run", "--no-default-browser-check"] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

  // 1. an ad click lands on the shop; the checkout creates a PayPal order carrying the click
  await page.goto(`${BASE}/shop.html?ad=trial_video&fbclid=IwARe2e${Date.now()}`, { waitUntil: "networkidle" });
  ok("shop shows the product", (await page.textContent("body")).includes("Robotics trial class"));
  const order = await page.evaluate(async () => {
    const r = await fetch("/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ad: "trial_video", source: "fb", click_id: "IwARe2e", clicked_at: Date.now(), intent: "e2e-" + Date.now() }) });
    return r.json();
  });
  ok("PayPal order created with the click in custom_id", /^[A-Z0-9]{10,24}$/.test(order.id || "") && order.custom_id?.includes("c=IwARe2e"), order.id);

  // 2. the dashboard answers before AG Studio loads; Studio arrives as its own chunk when scrolled to
  // the desk paints without AG Studio; Studio's chunk is only prefetched once the page has loaded and the browser is idle
  const early = []; let loaded = false;
  page.on("request", (r) => { if (r.resourceType() === "script" && !loaded) early.push(r.url()); });
  page.once("load", () => { loaded = true; });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForSelector("#captures .cap", { timeout: 30000 });
  ok("dashboard renders without loading AG Studio", !early.some((u) => u.includes("StudioPanel")), `${early.length} scripts before load`);
  await page.goto(`${BASE}/#report`, { waitUntil: "networkidle" });
  await page.waitForSelector(".funnel", { timeout: 60000 });
  ok("the report view opens AG Studio full screen", (await page.locator(".studio").boundingBox()).height > 500);
  const head = await page.textContent("h1");
  ok("headline compares leads with PayPal paid orders", /Ads report \d+ leads\. PayPal confirms \d+ paid orders?\./.test(head), head);
  await page.waitForFunction(() => document.querySelectorAll(".claim-row").length >= 4 && document.querySelectorAll(".fn-row").length >= 4, null, { timeout: 30000 }).catch(() => {});
  ok("claimed-vs-confirmed widget renders", await page.locator(".claim-row").count() >= 4);
  ok("lead/invoice/paid widget renders", await page.locator(".fn-row").count() >= 4);
  ok("payments list shows every capture", await page.locator("#captures .cap").count() >= 8);

  // 3. a refund on a seeded payment is previewed, not sent
  const preview = await page.evaluate(async () => (await fetch("/api/refund", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ capture_id: "392527382E750334K", amount: "1" }) })).json());
  ok("seeded payment refund is a preview", preview.preview === true && /previewed/.test(preview.message));

  // 4. the timeline widget on the PayPal captures page
  await page.evaluate(() => { const a = window.__studio; const s = a.getState(); a.setState({ ...s, selectedPageId: "captures" }); });
  await page.waitForSelector(".timeline svg", { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll(".timeline circle").length >= 8, null, { timeout: 15000 }).catch(() => {});
  ok("payment timeline widget renders", await page.locator(".timeline circle").count() >= 8);

  // 5. MCP: initialize, list tools, read the reconciliation
  const mcp = async (body) => (await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) })).json();
  const init = await mcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "e2e", version: "1" } } });
  ok("MCP initialize", init.result?.serverInfo?.name === "paid-signal");
  const tools = await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  ok("MCP lists six read-only tools", tools.result?.tools?.length === 6 && tools.result.tools.every((t) => t.annotations?.readOnlyHint));
  const prop = await mcp({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "propose_budget", arguments: {} } });
  const proposal = JSON.parse(prop.result?.content?.[0]?.text || "{}");
  ok("MCP propose_budget proposes and changes nothing", proposal.applied === false && proposal.proposal?.length === 4);
  const read = await mcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "read_paid_signal", arguments: {} } });
  const data = JSON.parse(read.result?.content?.[0]?.text || "{}");
  ok("MCP read_paid_signal returns 62 leads", data.totals?.leads === 62, `paid ${data.totals?.paid_orders}`);
} finally {
  await browser.close();
}
const failed = checks.filter((c) => !c.pass);
console.log(`${checks.length - failed.length}/${checks.length} end-to-end checks passed`);
process.exit(failed.length ? 1 : 0);
