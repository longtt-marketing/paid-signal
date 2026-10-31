import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

// the Worker paints the headline numbers into #root; keep showing them while the app loads the ledger, so nothing flickers
const painted = [...document.querySelectorAll("#root .duo b.n")].map((b) => Number(b.textContent));
const first = painted.length === 2 && painted.every(Number.isFinite) ? { leads: painted[0], paid: painted[1] } : null;

createRoot(document.getElementById("root")).render(<StrictMode><App first={first} /></StrictMode>);
