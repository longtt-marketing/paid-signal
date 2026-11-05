// Browser-local CSV decoding and attribution for Meta lead exports and PayPal activity rows.
// This module has no DOM or network access; customer emails are used only during matching.

export function decodeExport(input) {
  if (typeof input === "string") return input.replace(/^\uFEFF/, "");
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  return new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
}

function rowsFrom(input) {
  const source = decodeExport(input).replace(/\r\n?/g, "\n");
  const first = source.split("\n", 1)[0] || "";
  const delimiter = first.includes("\t") ? "\t" : ",";
  const rows = []; let row = [], field = "", quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); if (row.some((v) => v.trim())) rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field || row.length) { row.push(field); if (row.some((v) => v.trim())) rows.push(row); }
  return rows;
}

function objectsFrom(input) {
  const [header = [], ...body] = rowsFrom(input);
  const normalized = header.map((name) => name.trim().toLowerCase());
  return body.map((cells) => Object.fromEntries(normalized.map((name, i) => [name, String(cells[i] ?? "").trim()])));
}

const emailOf = (value) => String(value ?? "").trim().toLowerCase();
const dateOf = (value) => {
  const normalized = String(value ?? "").trim().replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? null : ms;
};
const paypalTimezones = { UTC: 0, GMT: 0, PST: -8, PDT: -7, MST: -7, MDT: -6, CST: -6, CDT: -5, EST: -5, EDT: -4 };
function paypalDateOf(row, fallback) {
  const zone = String(row.timezone ?? "").trim().toUpperCase();
  if (Object.hasOwn(paypalTimezones, zone)) {
    const localAsUtc = Date.parse(`${row.date || ""} ${row.time || ""} UTC`);
    if (!Number.isNaN(localAsUtc)) return localAsUtc - paypalTimezones[zone] * 60 * 60 * 1000;
  }
  if (/^[+-]\d{2}:?\d{2}$/.test(zone)) {
    const offset = zone.replace(":", "");
    const local = Date.parse(`${row.date || ""} ${row.time || ""} ${offset}`);
    if (!Number.isNaN(local)) return local;
  }
  return dateOf(fallback) ?? dateOf(`${row.date || ""} ${row.time || ""}`);
}

export function parseMetaLeadCsv(input) {
  const rows = objectsFrom(input);
  if (!rows.length) return { leads: [], errors: ["The Meta lead export is empty."] };
  const required = ["created_time", "ad_id", "ad_name", "email"];
  const missing = required.filter((name) => !Object.hasOwn(rows[0], name));
  if (missing.length) return { leads: [], errors: [`The Meta lead export needs columns: ${missing.join(", ")}.`] };
  const leads = rows.map((row, index) => ({
    created_time: row.created_time,
    created_at_ms: dateOf(row.created_time),
    ad_id: row.ad_id,
    ad_name: row.ad_name,
    email: emailOf(row.email),
    source_row: index + 2,
  })).filter((lead) => lead.email && lead.ad_name && lead.created_at_ms != null);
  return { leads, errors: [] };
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wholeWordMatch = (text, needle) => {
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(needle)}($|[^\\p{L}\\p{N}_])`, "iu");
  return pattern.test(text);
};

function adFromTag(custom, item, keys) {
  const raw = String(custom ?? "").trim();
  const tagged = raw.match(/(?:^|;)a=([^;]+)/i);
  if (tagged) return keys.get(tagged[1].trim().toLowerCase()) || tagged[1].trim();
  const utm = raw.match(/utm_content=([^&;\s]+)/i);
  if (utm) {
    let name = utm[1];
    try { name = decodeURIComponent(name); } catch { /* Keep the literal tag if malformed. */ }
    return keys.get(name.trim().toLowerCase()) || name.trim();
  }
  for (const value of [raw, String(item ?? "").trim()]) {
    if (value && keys.has(value.toLowerCase())) return keys.get(value.toLowerCase());
  }
  return "";
}

function cents(value) {
  const number = Number(String(value ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

/**
 * Applies email and invoice text matching to ledger payments while preserving existing order tags.
 * Email, invoice and item data are read from the local PayPal CSV, keyed by Transaction ID.
 */
export function matchPaymentsToLeads({ payments, paypalInput, leads = [], adKeys = [] }) {
  const paypalRows = objectsFrom(paypalInput);
  const byId = new Map(paypalRows.map((row) => [row["transaction id"], row]));
  const keys = new Map(adKeys.map((name) => [String(name).trim().toLowerCase(), name]));
  const aliases = new Map(adKeys.map((name) => [String(name).trim().toLowerCase(), name]));
  for (const lead of leads) if (lead.ad_id && lead.ad_name) aliases.set(String(lead.ad_id).trim().toLowerCase(), keys.get(lead.ad_name.trim().toLowerCase()) || lead.ad_name.trim());
  const names = [...aliases.keys()].sort((a, b) => b.length - a.length);
  const result = payments.map((payment) => {
    const row = byId.get(payment.capture_id) || {};
    const custom = row["custom number"] || row["custom field"] || row.custom || "";
    const item = row["item title"] || "";
    const invoice = row["invoice number"] || "";
    const taggedAd = adFromTag(custom, item, keys);
    let ad = "", match_label = "no ad";
    if (taggedAd) {
      ad = taggedAd;
      match_label = "ad tag in the order";
    } else {
      const payer = emailOf(row["from email address"]);
      const paidAt = paypalDateOf(row, payment.captured_at);
      if (payer && paidAt != null) {
        const prior = leads.filter((lead) => emailOf(lead.email) === payer && lead.created_at_ms != null && lead.created_at_ms < paidAt)
          .sort((a, b) => b.created_at_ms - a.created_at_ms)[0];
        if (prior) {
          ad = keys.get(prior.ad_name.trim().toLowerCase()) || prior.ad_name.trim();
          match_label = "matched by email";
        }
      }
      if (!ad) {
        const text = `${invoice}\n${item}`;
        const found = names.find((name) => wholeWordMatch(text, name));
        if (found) {
          ad = aliases.get(found.toLowerCase()) || found;
          match_label = "ad name in the invoice";
        }
      }
    }
    return { ...payment, ad, attributed_by: match_label, match_label };
  });
  const counts = {
    matched: result.filter((p) => p.ad).length,
    email: result.filter((p) => p.match_label === "matched by email").length,
    tag: result.filter((p) => p.match_label === "ad tag in the order").length,
    invoice: result.filter((p) => p.match_label === "ad name in the invoice").length,
    unmatched: result.filter((p) => !p.ad).length,
    unmatched_net_cents: result.filter((p) => !p.ad).reduce((sum, p) => sum + Math.max(0, cents(p.amount) - cents(p.refunded_amount)), 0),
  };
  return { payments: result, counts };
}
