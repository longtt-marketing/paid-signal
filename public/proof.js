// The live numbers on /proof: read from the running app when the page opens.
const $ = (id) => document.getElementById(id);
const get = (p) => fetch(p).then((r) => r.json());

get("/api/paypal-check").then((d) => {
  if (d.status === "unavailable") { $("pp").textContent = "n/a"; $("pp-note").textContent = d.reason; return; }
  const matched = (d.matched || []).length, missing = d.missing_from_paypal_report || [], lag = (d.after_report_refresh || []).length;
  $("pp").textContent = `${matched} / ${d.ledger_count ?? matched}`;
  $("pp-note").textContent = missing.length ? `Missing in PayPal: ${missing.join(", ")}` : `None missing${lag ? `; ${lag} newer than PayPal's report, which can lag up to 3 hours` : ""}. Checked ${new Date(d.checked_at).toLocaleString()}.`;
}).catch(() => { $("pp").textContent = "n/a"; $("pp-note").textContent = "Could not reach PayPal."; });

get("/api/ledger").then((d) => {
  const sent = (d.meta || []).filter((m) => m.ok), held = (d.duplicates || []).length;
  const live = sent.filter((m) => !m.backfill).length;
  $("meta").textContent = String(sent.length);
  $("meta-note").textContent = `${live} sent live at capture, ${sent.length - live} sent once when live sending was added. Held captures are never sent.`;
  $("held").textContent = String(held);
}).catch(() => { $("meta").textContent = "n/a"; });
