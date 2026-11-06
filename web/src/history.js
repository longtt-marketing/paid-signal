// The Studio assistant's conversations for this visit, kept in memory, opening with recorded runs of real agent turns
// (saved-threads.json: recorded from the live app, replaying them calls no model). A judge who has not typed anything
// still sees the agents work: the budget agent through the evidence gate, invoices drafted, reminders sent.
import SAVED from "./saved-threads.json";

export const REPLAY_EVENT = "ps-replay-open";
export function seededHistory() {
  const threads = new Map();
  (SAVED.threads || []).forEach((t, i) => threads.set(t.summary.threadId, { ...t, summary: { ...t.summary, updatedAt: i } }));
  const saved = new Set(threads.keys());
  const listeners = new Set();
  const store = {
    listThreads: async () => [...threads.values()].map((t) => t.summary).sort((a, b) => a.updatedAt - b.updatedAt),
    // opening a saved thread puts back on the report what that run added (the budget run's chart), so the replay shows
    // its effect on the dashboard as well as its words; StudioPanel listens for this event
    loadThread: async (id) => { const t = threads.get(id); if (t && saved.has(id) && typeof window !== "undefined") { window.__psLastOpened = t.summary.title; window.dispatchEvent(new CustomEvent(REPLAY_EVENT, { detail: { title: t.summary.title } })); } return t; },
    saveThread: async (thread) => { threads.set(thread.summary.threadId, thread); },
    deleteThread: async (id) => { threads.delete(id); },
    addEventListener: (_type, l) => listeners.add(l),
    removeEventListener: (_type, l) => listeners.delete(l),
  };
  // lets the recording step read a finished run back out (scripts: copy window.__psThreads into saved-threads.json)
  if (typeof window !== "undefined") window.__psThreads = threads;
  return store;
}
