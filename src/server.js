import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as store from "./db.js";
import { chat } from "./agent.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const APP_TOKEN = process.env.APP_TOKEN || "";
const DEFAULT_TZ = process.env.TZ_DEFAULT || "Europe/Rome";

if (!APP_TOKEN) {
  console.warn("⚠️  APP_TOKEN is not set — the API is open to anyone who can reach this server.");
}

const app = express();
app.use(express.json({ limit: "12mb" }));
app.use(express.text({ type: "text/plain", limit: "1mb" }));
app.use(express.static(path.join(here, "..", "public")));

// --- auth -------------------------------------------------------------------
function authorized(req) {
  if (!APP_TOKEN) return true;
  const header = req.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : String(req.query.token ?? "");
  const a = Buffer.from(given);
  const b = Buffer.from(APP_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
app.use("/api", (req, res, next) => (authorized(req) ? next() : res.status(401).json({ error: "unauthorized" })));

// --- helpers ----------------------------------------------------------------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The user's local date (YYYY-MM-DD) and time (HH:MM) in the given IANA time zone. */
function localNow(tz) {
  let zone = DEFAULT_TZ;
  if (tz) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      zone = tz;
    } catch { /* invalid tz, keep default */ }
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

const dateParam = (req) =>
  DATE_RE.test(req.query.date ?? "") ? req.query.date : localNow(req.query.tz).date;

// --- routes -----------------------------------------------------------------

// Talk to Claude. Body: { text, tz?, image?: { media_type, data(base64) } }
// Also accepts a text/plain body (handy for iOS Shortcuts). Add ?format=text to
// get the reply back as plain text, ready for Siri's "Speak Text" action.
app.post("/api/chat", async (req, res) => {
  const body = typeof req.body === "string" ? { text: req.body } : req.body ?? {};
  const text = String(body.text ?? "").trim();
  const image = body.image?.data && body.image?.media_type ? body.image : undefined;
  if (!text && !image) return res.status(400).json({ error: "Say something first." });

  const { date, time } = localNow(body.tz ?? req.query.tz);
  try {
    const result = await chat({ text, date, time, image });
    if (req.query.format === "text") return res.type("text/plain").send(result.reply);
    res.json({ ...result, date });
  } catch (err) {
    console.error(err);
    const message = err?.status === 401 || /authentication/i.test(err?.message ?? "")
      ? "The server's ANTHROPIC_API_KEY is missing or invalid."
      : "Claude is unavailable right now, please try again.";
    if (req.query.format === "text") return res.status(502).type("text/plain").send(message);
    res.status(502).json({ error: message });
  }
});

app.get("/api/day", (req, res) => {
  const date = dateParam(req);
  res.json({ ...store.daySummary(date), messages: store.messagesForDate(date) });
});

app.get("/api/history", (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 365);
  res.json(store.history(dateParam(req), days));
});

app.delete("/api/entries/:id", (req, res) => {
  const ok = store.deleteEntry(Number(req.params.id));
  res.status(ok ? 200 : 404).json({ ok });
});

app.get("/api/goals", (_req, res) => res.json(store.getGoals()));
app.put("/api/goals", (req, res) => res.json(store.setGoals(req.body ?? {})));

app.listen(PORT, () => console.log(`Tracker running on http://localhost:${PORT}`));
