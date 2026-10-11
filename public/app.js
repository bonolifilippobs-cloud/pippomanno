const $ = (id) => document.getElementById(id);
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

// ---------- storage (per-device conveniences only) ----------
const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// ---------- dates ----------
const toISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayISO = () => toISO(new Date());
const shiftISO = (iso, days) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toISO(d);
};
const prettyDate = (iso) => {
  if (iso === todayISO()) return "Today";
  if (iso === shiftISO(todayISO(), -1)) return "Yesterday";
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
};

let currentDate = todayISO();
const fmt = (n, d = 0) => (n == null ? "–" : Number(n).toLocaleString(undefined, { maximumFractionDigits: d }));

// ---------- api ----------
async function api(path, opts = {}) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${path}${sep}tz=${encodeURIComponent(tz)}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${storage.get("token") ?? ""}`,
      ...(opts.headers ?? {}),
    },
  });
  if (res.status === 401) {
    if (!opts.quiet) openSettings("Enter your access token to continue.");
    throw new Error("unauthorized");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------- rendering ----------
function renderHero({ totals, goals }) {
  const goal = goals.calories || 0;
  const budget = goal + totals.calories_burned;
  const left = Math.round(budget - totals.calories_in);
  $("kcalLeft").textContent = fmt(Math.abs(left));
  $("kcalLeftLabel").textContent = left >= 0 ? "kcal left" : "kcal over";
  $("kcalIn").textContent = `${fmt(totals.calories_in)} kcal`;
  $("kcalOut").textContent = `${fmt(totals.calories_burned)} kcal`;
  $("kcalGoal").textContent = `${fmt(goal)} kcal`;

  const C = 2 * Math.PI * 52;
  const pct = budget > 0 ? Math.min(totals.calories_in / budget, 1) : 0;
  const ring = $("ringFill");
  ring.style.strokeDasharray = `${C}`;
  ring.style.strokeDashoffset = `${C * (1 - pct)}`;
  ring.classList.toggle("over", left < 0);
}

function renderMacros({ totals, goals }) {
  const rows = [
    ["Protein", totals.protein_g, goals.protein_g, "--series-1"],
    ["Carbs", totals.carbs_g, goals.carbs_g, "--series-2"],
    ["Fat", totals.fat_g, goals.fat_g, "--series-3"],
  ];
  $("macros").innerHTML = rows.map(([name, val, goal, color]) => {
    const pct = goal ? Math.min((val / goal) * 100, 100) : 0;
    return `<div>
      <div class="bar-head">
        <span class="name"><span class="swatch" style="background:var(${color})"></span>${name}</span>
        <span>${fmt(val)} <span class="muted">/ ${fmt(goal)} g</span></span>
      </div>
      <div class="meter"><div class="meter-fill" style="width:${pct}%;background:var(${color})"></div></div>
    </div>`;
  }).join("") +
  `<div class="muted small">Fiber ${fmt(totals.fiber_g)} g · Sugar ${fmt(totals.sugar_g)} g · Sodium ${fmt(totals.sodium_mg)} mg</div>`;

  $("water").textContent = `${fmt(totals.water_ml / 1000, 2)} L`;
  $("waterGoal").textContent = goals.water_ml ? ` / ${fmt(goals.water_ml / 1000, 1)} L` : "";
  $("waterBar").style.width = `${goals.water_ml ? Math.min((totals.water_ml / goals.water_ml) * 100, 100) : 0}%`;
  $("exMin").textContent = fmt(totals.exercise_min);
  $("weightToday").textContent = totals.weight_kg ? `Weight ${fmt(totals.weight_kg, 1)} kg` : "";
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function entryRow(e) {
  let sub = "";
  let right = "";
  if (e.kind === "food") {
    sub = [e.quantity, `P ${fmt(e.protein_g)} · C ${fmt(e.carbs_g)} · F ${fmt(e.fat_g)}`].filter(Boolean).join(" · ");
    right = `${fmt(e.calories)} kcal`;
  } else if (e.kind === "exercise") {
    sub = [`${fmt(e.duration_min)} min`, e.notes].filter(Boolean).join(" · ");
    right = `−${fmt(e.calories_burned)} kcal`;
  } else if (e.kind === "water") {
    right = `${fmt(e.amount_ml)} ml`;
  } else if (e.kind === "weight") {
    right = `${fmt(e.weight_kg, 1)} kg`;
  }
  const name = e.name || { water: "Water", weight: "Weigh-in" }[e.kind] || e.kind;
  return `<div class="entry">
    <div class="entry-main">
      <div class="entry-name">${esc(name)}</div>
      ${sub || e.time ? `<div class="entry-sub">${esc([e.time, sub].filter(Boolean).join(" · "))}</div>` : ""}
    </div>
    <div class="entry-kcal">${right}</div>
    <button class="icon-btn del" data-del="${e.id}" aria-label="Delete ${esc(name)}">✕</button>
  </div>`;
}

function renderLog({ entries }) {
  if (!entries.length) {
    $("log").innerHTML = `<p class="empty">Nothing logged yet. Tap 🎙 and tell Claude what you ate.</p>`;
    return;
  }
  const groups = [
    ["breakfast", entries.filter((e) => e.kind === "food" && e.meal === "breakfast")],
    ["lunch", entries.filter((e) => e.kind === "food" && e.meal === "lunch")],
    ["dinner", entries.filter((e) => e.kind === "food" && e.meal === "dinner")],
    ["snacks", entries.filter((e) => e.kind === "food" && !["breakfast", "lunch", "dinner"].includes(e.meal))],
    ["exercise", entries.filter((e) => e.kind === "exercise")],
    ["water & weight", entries.filter((e) => e.kind === "water" || e.kind === "weight")],
  ];
  $("log").innerHTML = groups.filter(([, list]) => list.length).map(([title, list]) => {
    const kcal = list.reduce((s, e) => s + (e.calories ?? 0), 0);
    return `<div class="meal">
      <div class="meal-head"><span>${title}</span>${kcal ? `<span class="muted">${fmt(kcal)} kcal</span>` : ""}</div>
      ${list.map(entryRow).join("")}
    </div>`;
  }).join("");
}

function renderChat(messages) {
  $("chat").innerHTML = messages.length
    ? messages.map((m) => `<div class="msg ${m.role}">${esc(m.text)}</div>`).join("")
    : `<p class="empty">Try: “For breakfast I had two eggs, toast with butter and a cappuccino.”</p>`;
}

// ---------- charts (inline SVG, single series each) ----------
const tooltip = $("tooltip");
function showTip(evt, html) {
  tooltip.innerHTML = html;
  tooltip.hidden = false;
  const r = evt.currentTarget.getBoundingClientRect();
  tooltip.style.left = `${Math.min(Math.max(r.left + r.width / 2, 70), innerWidth - 70)}px`;
  tooltip.style.top = `${r.top}px`;
}
const hideTip = () => { tooltip.hidden = true; };
const shortDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "numeric" });

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p / (v / p > 5 ? 2 : 1)) * p * (v / p > 5 ? 2 : 1);
}

function renderCalorieChart(days, goal) {
  const W = 340, H = 160, L = 34, B = 18, T = 8;
  const max = niceMax(Math.max(goal, ...days.map((d) => d.calories_in)) * 1.05);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const step = (W - L) / days.length;
  const bw = Math.min(step - 2, 16);
  const ticks = [0, max / 2, max];
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Calories eaten per day">`;
  for (const t of ticks) svg += `<line class="gridline" x1="${L}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 3}" text-anchor="end">${fmt(t)}</text>`;
  days.forEach((d, i) => {
    const x = L + i * step + (step - bw) / 2;
    const h = Math.max(y(0) - y(d.calories_in), d.calories_in ? 2 : 0);
    const cls = d.calories_in > goal + d.calories_burned && goal ? "bar over" : "bar";
    // Bar with rounded top, square base
    const r = Math.min(4, bw / 2, h);
    const top = y(0) - h;
    svg += h ? `<path class="${cls}${d.date === currentDate ? "" : " dim"}" d="M${x},${y(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${y(0)} Z"/>` : "";
    if (i % 2 === (days.length - 1) % 2) svg += `<text x="${x + bw / 2}" y="${H - 4}" text-anchor="middle">${shortDay(d.date)}</text>`;
    svg += `<rect class="hit" x="${L + i * step}" y="${T}" width="${step}" height="${H - T - B}" data-i="${i}"/>`;
  });
  if (goal) svg += `<line class="goal" x1="${L}" x2="${W}" y1="${y(goal)}" y2="${y(goal)}"/><text x="${W}" y="${y(goal) - 4}" text-anchor="end">goal</text>`;
  svg += "</svg>";
  const el = $("calChart");
  el.innerHTML = svg;
  el.querySelectorAll(".hit").forEach((h) => {
    const d = days[Number(h.dataset.i)];
    const html = `<b>${prettyDate(d.date)}</b><br>${fmt(d.calories_in)} kcal in · ${fmt(d.calories_burned)} out<br>P ${fmt(d.protein_g)} · C ${fmt(d.carbs_g)} · F ${fmt(d.fat_g)} g`;
    h.addEventListener("pointerenter", (e) => showTip(e, html));
    h.addEventListener("pointerleave", hideTip);
    h.addEventListener("click", () => { currentDate = d.date; load(); });
  });
}

function renderWeightChart(days, target) {
  const pts = days.map((d, i) => ({ i, date: d.date, w: d.weight_kg })).filter((p) => p.w);
  const el = $("weightChart");
  if (!pts.length) {
    el.innerHTML = `<p class="empty">Say “I weigh 78.4 kg” to start your weight trend.</p>`;
    return;
  }
  const W = 340, H = 150, L = 34, B = 18, T = 8;
  const vals = pts.map((p) => p.w).concat(target ? [target] : []);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max((hi - lo) * 0.15, 0.5);
  lo = Math.floor(lo - pad); hi = Math.ceil(hi + pad);
  const x = (i) => L + ((W - L - 6) * i) / Math.max(days.length - 1, 1);
  const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Body weight trend">`;
  for (const t of [lo, (lo + hi) / 2, hi]) svg += `<line class="gridline" x1="${L}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 3}" text-anchor="end">${fmt(t, 1)}</text>`;
  if (target) svg += `<line class="goal" x1="${L}" x2="${W}" y1="${y(target)}" y2="${y(target)}"/><text x="${W}" y="${y(target) - 4}" text-anchor="end">target</text>`;
  svg += `<text x="${x(0)}" y="${H - 4}">${shortDay(days[0].date)}</text><text x="${x(days.length - 1)}" y="${H - 4}" text-anchor="end">${shortDay(days.at(-1).date)}</text>`;
  if (pts.length > 1) svg += `<path class="line" d="${pts.map((p, k) => `${k ? "L" : "M"}${x(p.i)},${y(p.w)}`).join(" ")}"/>`;
  const last = pts.at(-1);
  svg += `<circle class="dot" cx="${x(last.i)}" cy="${y(last.w)}" r="4"/>`;
  svg += `<text x="${x(last.i) - 6}" y="${y(last.w) + 16}" text-anchor="end" style="fill:var(--text-primary);font-weight:600">${fmt(last.w, 1)} kg</text>`;
  pts.forEach((p) => {
    svg += `<rect class="hit" x="${x(p.i) - 8}" y="${T}" width="16" height="${H - T - B}" data-i="${p.i}" data-w="${p.w}" data-date="${p.date}"/>`;
  });
  svg += "</svg>";
  el.innerHTML = svg;
  el.querySelectorAll(".hit").forEach((h) => {
    h.addEventListener("pointerenter", (e) => showTip(e, `<b>${prettyDate(h.dataset.date)}</b><br>${fmt(h.dataset.w, 1)} kg`));
    h.addEventListener("pointerleave", hideTip);
  });
}

// ---------- load ----------
async function load() {
  $("dateLabel").textContent = prettyDate(currentDate);
  $("nextDay").disabled = currentDate >= todayISO();
  try {
    const [day, cal, weight] = await Promise.all([
      api(`/api/day?date=${currentDate}`),
      api(`/api/history?days=14&date=${currentDate}`),
      api(`/api/history?days=60&date=${todayISO()}`),
    ]);
    renderHero(day);
    renderMacros(day);
    renderLog(day);
    renderChat(day.messages);
    renderCalorieChart(cal, day.goals.calories);
    renderWeightChart(weight, day.goals.target_weight_kg);
  } catch (err) {
    if (err.message !== "unauthorized") setStatus(err.message);
  }
}

// ---------- composer ----------
const input = $("input");
const setStatus = (t) => { $("status").textContent = t; };
let photo = null;

function autosize() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
}
input.addEventListener("input", autosize);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $("composer").requestSubmit();
  }
});

async function send() {
  const text = input.value.trim();
  if (!text && !photo) return;
  stopListening();
  $("send").disabled = true;
  setStatus("Claude is logging…");
  const body = { text, tz, ...(photo ? { image: photo } : {}) };
  input.value = "";
  autosize();
  clearPhoto();
  try {
    await api("/api/chat", { method: "POST", body: JSON.stringify(body) });
    currentDate = todayISO();
    setStatus("");
    await load();
    $("chat").lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) {
    if (err.message !== "unauthorized") setStatus(err.message);
    input.value = text;
  } finally {
    $("send").disabled = false;
  }
}
$("composer").addEventListener("submit", (e) => { e.preventDefault(); send(); });

// Photo: downscale on-device before upload
$("photoInput").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.85);
  photo = { media_type: "image/jpeg", data: url.split(",")[1] };
  $("photoImg").src = url;
  $("photoPreview").hidden = false;
});
function clearPhoto() { photo = null; $("photoPreview").hidden = true; }
$("clearPhoto").addEventListener("click", clearPhoto);

// ---------- voice ----------
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let listening = false;
let baseText = "";

function stopListening() {
  if (rec && listening) rec.stop();
}

$("mic").addEventListener("click", () => {
  if (!Recognition) {
    input.focus();
    setStatus("Voice input isn't available here — tap the 🎤 on your keyboard to dictate instead.");
    return;
  }
  if (listening) {
    rec.stop();
    return;
  }
  rec = new Recognition();
  rec.lang = navigator.language || "en-US";
  rec.interimResults = true;
  rec.continuous = true;
  baseText = input.value ? `${input.value.trim()} ` : "";
  let finalText = "";
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    input.value = baseText + finalText + interim;
    autosize();
  };
  rec.onstart = () => {
    listening = true;
    $("mic").classList.add("listening");
    setStatus("Listening… tap 🎙 again when you're done.");
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed") setStatus("Microphone permission denied. You can still type or use keyboard dictation.");
  };
  rec.onend = () => {
    const wasListening = listening;
    listening = false;
    $("mic").classList.remove("listening");
    if ($("status").textContent.startsWith("Listening")) setStatus("");
    if (wasListening && input.value.trim()) send();
  };
  rec.start();
});

// ---------- navigation & settings ----------
$("prevDay").addEventListener("click", () => { currentDate = shiftISO(currentDate, -1); load(); });
$("nextDay").addEventListener("click", () => {
  if (currentDate < todayISO()) { currentDate = shiftISO(currentDate, 1); load(); }
});
$("dateLabel").addEventListener("click", () => { currentDate = todayISO(); load(); });

$("log").addEventListener("click", async (e) => {
  const id = e.target.closest("[data-del]")?.dataset.del;
  if (!id || !confirm("Delete this entry?")) return;
  await api(`/api/entries/${id}`, { method: "DELETE" });
  load();
});

const dlg = $("settings");
const form = $("settingsForm");
async function openSettings(message) {
  form.token.value = storage.get("token") ?? "";
  if (message) setStatus(message);
  try {
    const goals = await api("/api/goals", { quiet: true });
    for (const k of ["calories", "protein_g", "carbs_g", "fat_g", "water_ml", "target_weight_kg"]) form[k].value = goals[k] ?? "";
  } catch { /* token not set yet */ }
  if (!dlg.open) dlg.showModal();
}
$("openSettings").addEventListener("click", () => openSettings());
dlg.addEventListener("close", async () => {
  if (dlg.returnValue !== "save") return;
  storage.set("token", form.token.value.trim());
  const goals = {};
  for (const k of ["calories", "protein_g", "carbs_g", "fat_g", "water_ml", "target_weight_kg"]) {
    if (form[k].value !== "") goals[k] = Number(form[k].value);
  }
  try {
    await api("/api/goals", { method: "PUT", body: JSON.stringify(goals) });
    setStatus("");
  } catch { /* handled in api() */ }
  load();
});

// Refresh when coming back to the app (e.g. after logging via Siri)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") load();
});

load();
