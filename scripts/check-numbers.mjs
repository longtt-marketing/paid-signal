import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseAdCsv, reconcile, paybackOdds } from "../src/ledger.js";

const BASE = (process.env.PAID_SIGNAL_URL || "https://paid-signal.thelongmarketing.workers.dev").replace(/\/$/, "");
const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
const ALIASES = {
  trial_video: /\btrial class\b|\btrial video\b/i,
  free_guide: /\bfree guide\b/i,
  parent_carousel: /\bparent carousel\b|\btestimonial(?:\s+carousel)?\b|\bcarousel\b/i,
  holiday_static: /\bholiday camp\b|\bholiday static\b/i,
};

const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const cents = (value) => Math.round(Number(String(value).replace(/,/g, "")) * 100);
const historical = (line) => new RegExp(`\\b(?:on|as of)\\s+(?:the\\s+)?(?:\\d{1,2}\\s+(?:${MONTHS})|20\\d{2}-\\d{2}-\\d{2})\\b[^\\n]*\\bledger\\b`, "i").test(line);
const otherEvidence = (line) => /\b(?:simulation|synthetic week|held-out|not-ready leads|real case|Bunq|Kaggle|completed orders|order lines|VND)\b/i.test(line);

function adNear(line, index, stats) {
  const named = Object.entries(ALIASES).map(([key, pattern]) => ({ key, match: pattern.exec(line) })).filter((x) => x.match);
  const near = named.map((x) => ({ key: x.key, distance: index - x.match.index })).filter((x) => x.distance >= 0 && x.distance <= 80).sort((a, b) => a.distance - b.distance);
  if (near.length) return near[0].key;
  const before = line.slice(0, index), leads = [...before.matchAll(/\b(\d[\d,]*)\s+leads?\b/gi)];
  if (leads.length) {
    const count = Number(leads.at(-1)[1].replace(/,/g, ""));
    const found = stats.ads.filter((ad) => ad.leads === count);
    if (found.length === 1) return found[0].ad;
  }
  return null;
}

function expectedPaidLabel(ad) { return ad ? `${ad.ad} paid orders` : "paid orders"; }

export function findNumberContradictions(text, stats, file = "") {
  const issues = [];
  const add = (line, n, message) => issues.push({ file, line: n, message });
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const line of lines[i].replace(/<[^>]*>/g, " ").replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, " ").split(/(?<=\.)\s+(?=[A-Z])/)) {
    const plain = line.replace(/<[^>]*>/g, " ").replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, " ");
    const low = plain.toLowerCase();
    if (!plain.trim() || historical(plain) || otherEvidence(plain)) continue;
    const context = /\b(?:live ledger|ledger|live demo|dashboard|demo shop|demo ads|demo week|ads report|paypal confirms|paypal says is paying|owner asks|fictional shop|paid signal)\b/i.test(plain);
    const previousLead = (before) => {
      const values = [...before.matchAll(/\b(\d[\d,]*)\s+leads?\b/gi)];
      return values.length ? Number(values.at(-1)[1].replace(/,/g, "")) : null;
    };
    const leadNumbers = [...plain.matchAll(/\b(\d[\d,]*)\s+leads?\b/gi)];
    for (const m of leadNumbers) {
      const value = Number(m[1].replace(/,/g, ""));
      const found = stats.ads.filter((row) => row.leads === value);
      if (found.length === 1 && (context || /claude|payPal|paid order|ad\b/i.test(plain))) {
        if (value !== found[0].leads) add(line, i + 1, `leads for ${found[0].ad} are ${found[0].leads}, found ${value}`);
      } else if (context && !/unpaid|not-ready|held-out/i.test(plain) && value !== stats.totals.leads) {
        add(line, i + 1, `total leads are ${stats.totals.leads}, found ${value}`);
      }
    }

    const distribution = low.match(/\b(one|two|three|four|five|\d+)\s+ads?\s+(?:has|have|with)\s+(\d+)(\s+or more)?\s+paid orders?\b/);
    if (distribution && !/fewer than|at least|minimum|threshold|rule/i.test(plain)) {
      const number = { one: 1, two: 2, three: 3, four: 4, five: 5 }[distribution[1]] ?? Number(distribution[1]);
      const ads = Number(distribution[2]);
      const actual = stats.ads.filter((row) => distribution[3] ? row.paid >= ads : row.paid === ads).length;
      if (number !== actual) add(line, i + 1, `${number} ad(s) are claimed to have ${ads} paid orders; the ledger has ${actual}`);
    }

    const share = [...plain.matchAll(/\b(\d[\d,]*)\s+of\s+(\d[\d,]*)\s+(?:PayPal-confirmed\s+)?paid orders?\b/gi)];
    for (const m of share) {
      const counted = Number(m[1].replace(/,/g, "")), total = Number(m[2].replace(/,/g, ""));
      const rowKey = adNear(plain, m.index, stats), row = rowKey && stats.ads.find((item) => item.ad === rowKey);
      if (row && counted !== row.paid) add(line, i + 1, `${row.ad} has ${row.paid} paid orders, found ${counted}`);
      if (context && !/below|fewer than|at least|minimum|threshold|rule|per ad/i.test(plain) && total !== stats.totals.paid) add(line, i + 1, `total paid orders are ${stats.totals.paid}, found ${total}`);
    }

    const sharedAt = (index) => share.some((m) => index >= m.index && index < m.index + m[0].length);
    const distributionAt = (index) => distribution && index >= distribution.index && index < distribution.index + distribution[0].length;
    const paid = [...plain.matchAll(/\b(\d[\d,]*)\s+(?:PayPal-confirmed\s+)?paid orders?\b/gi)].filter((m) => !sharedAt(m.index) && !distributionAt(m.index));
    for (const m of paid) {
      const value = Number(m[1].replace(/,/g, ""));
      const before = plain.slice(0, m.index);
      if (/\b(?:below|under|fewer than|at least|minimum|threshold|rule)\s*$/i.test(before)) continue;
      const target = adNear(plain, m.index, stats);
      const leadCount = previousLead(before);
      const inferred = target || (leadCount === null ? null : stats.ads.find((row) => row.leads === leadCount)?.ad);
      if (inferred) {
        const expected = stats.ads.find((row) => row.ad === inferred)?.paid;
        if (expected !== undefined && value !== expected) add(line, i + 1, `${expectedPaidLabel(stats.ads.find((row) => row.ad === inferred))} are ${expected}, found ${value}`);
      } else if (context && !/below|fewer than|at least|minimum|threshold|rule|per ad/i.test(plain) && value !== stats.totals.paid) {
        add(line, i + 1, `total paid orders are ${stats.totals.paid}, found ${value}`);
      }
    }

    for (const m of plain.matchAll(/\$\s*(-?[\d,]+(?:\.\d{1,2})?)/g)) {
      const value = cents(m[1]);
      const at = m.index;
      const before = plain.slice(Math.max(0, at - 48), at);
      const after = plain.slice(at + m[0].length, at + m[0].length + 48);
      const around = `${before} ${after}`.toLowerCase();
      if (/per\s*$/.test(before)) continue;
      const rowKey = adNear(plain, at, stats);
      const row = rowKey && stats.ads.find((item) => item.ad === rowKey);
      const near = (words) => {
        const found = [...around.matchAll(words)].map((x) => x.index);
        return found.length ? Math.min(...found.map((x) => Math.abs(x - before.length))) : Infinity;
      };
      const ratio = near(/\bback per \$1|\bper \$1/g);
      const isRevenue = near(/\bpaid revenue\b|\brevenue\b/g);
      const isSpend = near(/\bad spend\b|\bspend\b|\bspent\b|\bof ads\b/g);
      const isNet = near(/\bnet\b/g);
      const cutPoint = /\bnext\b/i.test(before) && /\bno paid order\b/i.test(after);
      if (cutPoint && row) {
        const target = stats.odds[row.ad]?.more_spend_to_decide_cents;
        if (target != null && value !== target) add(line, i + 1, `${row.ad} no-order cut point is ${money(target)}, found ${money(value)}`);
        continue;
      }
      if (ratio < 28 && row) {
        const expected = Math.round(row.revenue_cents / row.spend_cents * 100) / 100;
        if (Number(m[1].replace(/,/g, "")) !== expected) add(line, i + 1, `${row.ad} revenue per ad dollar is $${expected.toFixed(2)}, found $${Number(m[1].replace(/,/g, "")).toFixed(2)}`);
      } else if (Math.min(isRevenue, isSpend, isNet) < 34 && (context || row)) {
        const metric = isNet <= isRevenue && isNet <= isSpend ? "net" : isSpend <= isRevenue ? "spend" : "revenue";
        const expected = row ? row[`${metric}_cents`] : stats.totals[`${metric}_cents`];
        if (value !== expected) add(line, i + 1, `${row ? `${row.ad} ${metric}` : `total ${metric}`} is ${money(expected)}, found ${money(value)}`);
      }
    }

    for (const m of plain.matchAll(/\b(\d+(?:\.\d+)?)\s*%\s*(?:chance|probability)\b/gi)) {
      const target = adNear(plain, m.index, stats) || (low.includes("free guide") ? "free_guide" : null);
      const expected = target && stats.odds[target] != null ? Math.round(stats.odds[target].chance * 100) : null;
      const found = Number(m[1]);
      if (expected !== null && expected !== found) add(line, i + 1, `${target} chance of covering spend is ${expected}%, found ${found}%`);
    }
    }
  }
  return issues;
}

async function jsonGet(path) {
  const response = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`GET ${path} returned ${response.status}.`);
  return response.json();
}

export function normalizeLedgerPayments(payments) {
  // The public ledger replaces the private email hash with a salted same-payer key; reconcile needs that equality signal.
  return payments.map((payment) => ({ ...payment, payer_email_sha256: payment.payer_email_sha256 ?? payment.payer_key ?? null }));
}

export async function checkNumbers(root = process.cwd()) {
  const [ledger, csvResponse] = await Promise.all([jsonGet("/api/ledger"), fetch(`${BASE}/data/demo-ads.csv`)]);
  if (!csvResponse.ok) throw new Error(`GET /data/demo-ads.csv returned ${csvResponse.status}.`);
  const parsed = parseAdCsv(await csvResponse.text());
  if (parsed.errors.length) throw new Error(parsed.errors.join(" "));
  const reconciliation = reconcile(parsed.rows, normalizeLedgerPayments(ledger.payments || []));
  const odds = paybackOdds(reconciliation).ads;
  const stats = { totals: reconciliation.totals, ads: reconciliation.ads, odds: Object.fromEntries(Object.entries(odds).map(([key, value]) => [key, { chance: value.chance_covers_spend, more_spend_to_decide_cents: value.more_spend_to_decide_cents }])) };
  const files = ["SUBMISSION.md", "README.md", ...(await readdir(join(root, "public"))).filter((name) => name.endsWith(".html")).map((name) => join("public", name))];
  const issues = [];
  for (const relative of files) {
    const text = await readFile(join(root, relative), "utf8");
    issues.push(...findNumberContradictions(text, stats, relative));
  }
  return { stats, issues };
}

async function main() {
  const { stats, issues } = await checkNumbers();
  const t = stats.totals;
  process.stdout.write(`Live ledger: ${t.leads} leads, ${t.paid} paid orders, ${money(t.revenue_cents)} revenue, ${money(t.spend_cents)} spend, ${money(t.net_cents)} net.\n`);
  for (const ad of stats.ads) process.stdout.write(`${ad.ad}: ${ad.paid} paid order(s)\n`);
  for (const issue of issues) process.stdout.write(`${issue.file}:${issue.line}: ${issue.message}\n`);
  if (!issues.length) process.stdout.write("No contradictions found.\n");
  process.exitCode = issues.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
