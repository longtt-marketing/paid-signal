import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
const dir = process.argv[2];
const old = process.argv[3];
const img = (f) => pathToFileURL(f).href;
const css = `
@import url('https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&display=swap');
*{box-sizing:border-box;margin:0}
body{width:1500px;height:1000px;background:#0E0F0E;color:#fff;font-family:"Inter Tight",system-ui,sans-serif;font-variant-numeric:tabular-nums;overflow:hidden}
.wrap{position:absolute;inset:0;padding:56px 64px;display:flex;flex-direction:column;gap:28px}
.top{display:flex;align-items:center;gap:14px;font-size:20px;font-weight:600;color:#9A9A94}
.mark{width:26px;height:26px;border-radius:8px;background:#fff;display:grid;place-items:center}.mark i{width:10px;height:10px;border-radius:50%;background:#2BD47D}
.step{color:#2BD47D;margin-left:auto;font-size:20px}
h1{font-size:52px;line-height:1.06;letter-spacing:-.03em;font-weight:700;max-width:1300px}
h1 em{font-style:normal;color:#2BD47D}
.frame{flex:1;min-height:0;background:#fff;border-radius:18px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 30px 80px rgba(0,0,0,.45)}
.bar{height:34px;background:#ECECE8;display:flex;align-items:center;gap:8px;padding:0 16px;flex:0 0 auto}.bar i{width:11px;height:11px;border-radius:50%;background:#CFCFC9}
.bar span{margin-left:14px;font-size:14px;color:#6A6A64}
.shot{flex:1;min-height:0;background:#F7F7F5;display:flex;align-items:flex-start;justify-content:center;overflow:hidden}
.shot img{width:100%;height:auto;display:block}
.frame.fit{flex:0 0 auto;margin:auto 0}.frame.fit .shot{flex:0 0 auto}.shot.fit img{width:100%}
`;
const page = (step, title, shot, url, fit) => `<html><head><style>${css}</style></head><body><div class="wrap">
<div class="top"><span class="mark"><i></i></span>Paid Signal<span class="step">${step}</span></div>
<h1>${title}</h1>
<div class="frame ${fit ? "fit" : ""}"><div class="bar"><i></i><i></i><i></i><span>${url}</span></div><div class="shot ${fit ? "fit" : ""}"><img src="${img(shot)}"></div></div>
</div></body></html>`;
const H = "paid-signal.thelongmarketing.workers.dev";
const cover = `<html><head><style>${css}
.big{font-size:84px;line-height:1.02;letter-spacing:-.035em;font-weight:700}
.big em{font-style:normal;color:#2BD47D}
.ads{display:flex;flex-direction:column;gap:36px;margin-top:44px}
.ad{display:grid;grid-template-columns:330px 1fr;gap:10px 28px;align-items:center}
.ad .n{grid-row:span 2;font-size:26px;font-weight:600;color:#E8E8E3}
.r{display:grid;grid-template-columns:1fr 210px;gap:18px;align-items:center}
.r div{height:22px;border-radius:11px;background:#1E201E;overflow:hidden}.r i{display:block;height:100%;border-radius:11px}
.r b{font-size:26px;font-weight:600}.r b small{font-size:18px;color:#9A9A94;font-weight:500;margin-left:6px}
.c i{background:#6E6E68}.m i{background:#2BD47D}.m b{color:#2BD47D}
.foot{margin-top:auto;font-size:20px;color:#9A9A94}
</style></head><body><div class="wrap">
<div class="top"><span class="mark"><i></i></span>Paid Signal</div>
<div class="big">Ad reports count chats.<br><em>PayPal counts money.</em></div>
<div class="ads">
<div class="ad"><span class="n">Attention video ad</span><div class="r c"><div><i style="width:69.4%"></i></div><b>69%<small>of chats</small></b></div><div class="r m"><div><i style="width:19.3%"></i></div><b>19%<small>of money</small></b></div></div>
<div class="ad"><span class="n">Customer reviews ad</span><div class="r c"><div><i style="width:20.7%"></i></div><b>21%<small>of chats</small></b></div><div class="r m"><div><i style="width:56.3%"></i></div><b>56%<small>of money</small></b></div></div>
<div class="ad"><span class="n">Personalised for an occasion</span><div class="r c"><div><i style="width:9.9%"></i></div><b>10%<small>of chats</small></b></div><div class="r m"><div><i style="width:24.4%"></i></div><b>24%<small>of money</small></b></div></div>
</div>
<div class="foot">A real gift shop, October 2026: about $10,000 of ads, 735 bank transfers matched by hand</div>
</div></body></html>`;
const proofRows = [
  ["PayPal refund", "$49 double payment returned to the buyer", "COMPLETED", "40H58610AR045544E"],
  ["PayPal Payouts", "$15 to the ad's creator for 3 paid orders", "SUCCESS", "batch 29DTSH6RYGE4C"],
  ["Claude over MCP", "Sold one class; asked for its $5 only after PayPal confirmed", "COMPLETED", "capture 5NC08720EW4665251"],
  ["PayPal Payouts", "$5 commission to the agent program, after the owner approved", "SUCCESS", "batch FYYKYSK29SJTS"],
  ["Ledger vs PayPal", "Every ledger payment read back from PayPal", "13 / 13", "match"],
];
const proof = `<html><head><style>${css}
.rows{display:flex;flex-direction:column;gap:14px}
.row{display:grid;grid-template-columns:250px 1fr 230px;gap:24px;align-items:center;background:#181A18;border:1px solid #262826;border-radius:16px;padding:22px 26px}
.row .k{font-size:20px;color:#9A9A94;font-weight:600}.row .v{font-size:24px;font-weight:600;color:#F2F2EE}
.row .s{display:flex;flex-direction:column;align-items:flex-end;gap:6px}.row .s b{font-size:22px;color:#0B1F14;background:#2BD47D;border-radius:99px;padding:6px 14px}
.row .s b.w{background:#3A3A35;color:#F2F2EE}.row .s small{font-size:15px;color:#8A8A84;font-family:ui-monospace,Consolas,monospace}
</style></head><body><div class="wrap">
<div class="top"><span class="mark"><i></i></span>Paid Signal<span class="step">06</span></div>
<h1>Not assumed: <em>read back from PayPal</em></h1>
<div class="rows">${proofRows.map(([k, v, s, id]) => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span><span class="s"><b class="${/NOT/.test(s) ? "w" : ""}">${s}</b><small>${id}</small></span></div>`).join("")}</div>
</div></body></html>`;
const pages = {
  "01-cover": cover,
  "02-disagree": page("01", "The ad report and PayPal <em>disagree</em>", `${dir}/judge-hero.png`, H + "/judge", true),
  "03-loop": page("02", "Pay $49. <em>PayPal confirms.</em> Undo.", `${dir}/judge-loop.png`, H + "/judge", true),
  "04-studio": page("03", "The owner works in <em>AG Studio</em>; the ledger is an AG Grid table", `${dir}/studio.png`, H + "/studio"),
  "05-toolkit": page("04", "Ask in words; <em>AG Grid's AI Toolkit</em> groups and totals", `${old}/g1.png`, H + "/studio", true),
  "06-cant": page("05", "Agents draft, <em>code checks</em>, the owner approves", `${dir}/judge-cant.png`, H + "/judge", true),
  "07-proof": proof,
};
const b = await chromium.launch({ channel: "chrome" });
const pg = await b.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1.5 });
fs.mkdirSync(`${dir}/out`, { recursive: true });
for (const [name, html] of Object.entries(pages)) {
  const f = `${dir}/out/${name}.html`; fs.writeFileSync(f, html);
  await pg.goto(pathToFileURL(f).href, { waitUntil: "networkidle" }); await pg.waitForTimeout(600);
  await pg.screenshot({ path: `${dir}/out/${name}.png` });
  console.log(name);
}
await b.close();
