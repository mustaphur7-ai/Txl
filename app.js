"use strict";
const $ = id => document.getElementById(id);
const fmt = n => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kenya = d => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "medium" }).format(d);
const SOURCES = [
  "https://fapi.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT",
  "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT"
];
let levels = null, price = null, loadFailed = false, busy = false;

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

async function loadLevels() {
  try {
    levels = await getJSON("levels.json?t=" + Date.now());
    loadFailed = false;
    $("analyzed").textContent = kenya(new Date(levels.analyzed_at));
    $("spot").textContent = fmt(levels.spot_at_analysis);
    $("move").textContent = "±" + fmt(levels.expected_move_1sd);
  } catch (e) { loadFailed = true; }
  banner();
  ladder();
}

function banner() {
  const notes = [];
  if (loadFailed) notes.push("Could not load levels.json, retrying.");
  if (levels?.sample) notes.push("Sample data. Run the workflow to get real levels.");
  if (levels && Date.now() - new Date(levels.analyzed_at) > 26 * 3600e3) notes.push("Stale data: older than 26 hours.");
  $("banner").textContent = notes.join(" ");
  $("banner").hidden = !notes.length;
}

function ladder() {
  if (!levels) return;
  const rows = new Map();
  const add = (name, p, cls, oi) => {
    const key = Number(p).toFixed(2);
    const row = rows.get(key) || { names: [], price: p, cls, oi };
    row.names.push(name);
    row.oi = row.oi ?? oi;
    rows.set(key, row);
  };
  add("Call wall", levels.call_wall.price, "res", levels.call_wall.open_interest);
  add("Put wall", levels.put_wall.price, "sup", levels.put_wall.open_interest);
  add("Gamma flip", levels.gamma_flip, "flip");
  levels.resistances.forEach((l, i) => add("R" + (i + 1), l.price, "res", l.open_interest));
  levels.supports.forEach((l, i) => add("S" + (i + 1), l.price, "sup", l.open_interest));
  const list = [...rows.values()];
  if (price) list.push({ names: ["Price now"], price, cls: "now" });
  list.sort((a, b) => b.price - a.price);
  $("ladder").replaceChildren(...list.map(r => {
    const li = document.createElement("li");
    li.className = r.cls;
    const d = r.price - price, sign = d >= 0 ? "+" : "-";
    const cells = [r.names.join(", "), fmt(r.price)];
    if (r.cls !== "now") cells.push(
      r.oi == null ? "Open interest: none" : "Open interest: " + fmt(r.oi) + " BTC",
      price ? `${sign}$${fmt(Math.abs(d))} (${sign}${Math.abs(d / price * 100).toFixed(2)}%)` : "--");
    cells.forEach((text, i) => {
      const el = document.createElement(i > 1 ? "small" : "span");
      el.textContent = text;
      if (i % 2) el.style.textAlign = "right";
      li.append(el);
    });
    return li;
  }));
}

async function tick() {
  if (busy) return;
  busy = true;
  let ok = false;
  for (const url of SOURCES) {
    try {
      const p = Number((await getJSON(url)).price);
      if (p > 0) { price = p; ok = true; break; }
    } catch (e) { /* try the next source */ }
  }
  busy = false;
  $("dot").className = ok ? "on" : "";
  if (ok) {
    $("price").textContent = fmt(price);
    $("updated").textContent = "Updated " + kenya(new Date()) + " EAT";
    ladder();
  } else $("updated").textContent = "Price unavailable, retrying";
}

function countdown() {
  const now = new Date(), next = new Date(now);
  next.setUTCHours(14, 33, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const s = Math.floor((next - now) / 1000);
  $("countdown").textContent = [s / 3600, s / 60 % 60, s % 60].map(v => String(Math.floor(v)).padStart(2, "0")).join(":");
}

loadLevels(); tick(); countdown();
setInterval(tick, 5000);
setInterval(countdown, 1000);
setInterval(loadLevels, 300000);
