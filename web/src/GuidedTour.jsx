import { useEffect, useRef, useState } from "react";

const STEPS = [
  { label: "Ads vs PayPal", caption: "One click on the Testimonial ad filters the page: the PayPal ledger under it narrows to that ad, and the budget agent's suggestion waits for Approve." },
  { label: "A payment's history", caption: "▸ opens a payment's history: the ad click, the PayPal capture, the ledger, and what Meta was told." },
  { label: "AI Toolkit groups the grid", caption: "The assistant asks AG Grid's AI Toolkit for the grid's schema, then sets a grouped state…" },
  { label: "Read back from PayPal", caption: "Every invoice, reminder, refund and payout the agents made, with the status PayPal reports for it now." },
];

export default function GuidedTour({ autoStart, ready, onStep, onEnd, readBack, pointTo, openReplay, goAgents }) {
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [caption, setCaption] = useState("");
  const run = useRef(0);
  const autoStarted = useRef(false);

  const act = (n) => {
    setIndex(n);
    setCaption(STEPS[n].caption);
    const currentRun = ++run.current;
    onStep(n, (next) => { if (run.current === currentRun) setCaption(next); });
  };
  const start = () => {
    setActive(true);
    act(0);
  };
  const end = () => {
    ++run.current;
    setActive(false);
    onEnd?.();
  };

  useEffect(() => {
    if (autoStart && ready && !autoStarted.current) {
      autoStarted.current = true;
      start();
    }
  }, [autoStart, ready]);

  useEffect(() => {
    if (!active) return undefined;
    const key = (event) => { if (event.key === "Escape") end(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [active]);

  useEffect(() => {
    document.documentElement.classList.toggle("tour-running", active);
    return () => document.documentElement.classList.remove("tour-running");
  }, [active]);

  if (!active) return <ol className="judge-strip" aria-label="Try it: three clicks">
    <li><button type="button" className="js-tour-start" onClick={start}>▶ Take the 60-second tour</button></li>
    <li className="js-k">Try it</li>
    {readBack && <li><button type="button" className="js-link js-count" onClick={goAgents}>{readBack.read_back} of {readBack.total} agent actions found in PayPal</button>{readBack.checked_at && <span className="js-at"> · read {String(readBack.checked_at).slice(11, 16)} UTC{readBack.stale ? ", limit reached: older read" : ""}</span>}</li>}
    <li><button type="button" className="js-link" onClick={() => pointTo("Ad report vs PayPal: leads → paid money|1 · Leads", "[role=button][aria-label^='Testimonial']")}><b>1</b>Click an ad in the chart</button></li>
    <li><button type="button" className="js-link" onClick={() => pointTo("PayPal ledger (AG Grid)|2 · PayPal ledger", ".trail-toggle, button[aria-expanded]")}><b>2</b>Open a payment's history</button></li>
    <li><button type="button" className="js-link" onClick={() => pointTo("Who still owes", ".owes-act button")}><b>3</b>Send a kind reminder</button></li>
    <li><button type="button" className="js-link" onClick={openReplay}>Ask the assistant</button></li>
  </ol>;

  const finished = index === 4;
  return <section className="judge-tour" aria-label="Guided tour" aria-live="polite">
    <div className="jt-heading"><strong>Guided tour</strong><span>{finished ? "Done" : `Step ${index + 1} of 4`}</span></div>
    <p className="jt-caption">{finished ? "That was all real: PayPal sandbox and AG Grid's AI Toolkit." : caption}</p>
    {finished && <div className="jt-links"><a href="/judge">Pay as a customer</a><a href="/proof">How we measured it</a><button type="button" className="jt-end" onClick={end}>End</button></div>}
    {!finished && <ol className="jt-steps" aria-label="Tour steps">{STEPS.map((step, i) => <li key={step.label} className={i < index ? "done" : i === index ? "current" : "next"} aria-label={`${step.label}${i < index ? ", done" : i === index ? ", current step" : ""}`} aria-current={i === index ? "step" : undefined}><span>{i < index ? "✓" : i + 1}</span></li>)}</ol>}
    {!finished && <div className="jt-controls">
      <button type="button" disabled={index === 0} onClick={() => act(index - 1)}>Back</button>
      <button type="button" className="jt-next" onClick={() => index === 3 ? setIndex(4) : act(index + 1)}>{index === 3 ? "Done" : "Next"}</button>
      <button type="button" onClick={end}>End</button>
    </div>}
  </section>;
}
