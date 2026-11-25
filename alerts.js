// Point-of-interest alarm and buy/sell signal. No libraries, no audio files.
(function () {
  const $ = (id) => document.getElementById(id);
  const fp = (n) => Number(n).toFixed(2);
  const kenya = (t) => new Date(t).toLocaleString("en-GB", { timeZone: "Africa/Nairobi", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) + " EAT";
  const lsGet = (k, f) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch (e) { return f; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  const DEF = { band: 0.10, buf: 0.15, minRR: 1.5, vol: 0.7, vib: true, notify: true, ntfy: "", levels: {} };
  const set = Object.assign({}, DEF, lsGet("xl_set", {}));
  if (!set.levels) set.levels = {};
  const save = () => lsSet("xl_set", set);

  let L = null, levels = [], price = null, armed = false, ringing = false;
  const lvSt = {};
  const st = (id) => lvSt[id] || (lvSt[id] = { cool: false, snooze: 0 });
  let sig = lsGet("xl_sig", null);
  let log = lsGet("xl_log", []);
  let lastWait = "", last1m = 0, last5m = 0, busy = false;
  let catchup = !!(sig && sig.status === "Active");

  // ---------- data ----------
  const SRC = {
    XAUUSDT: "https://fapi.binance.com/fapi/v1/klines?symbol=XAUUSDT",
    PAXGUSDT: "https://api.binance.com/api/v3/klines?symbol=PAXGUSDT"
  };
  let sym = "XAUUSDT";
  async function kl(iv, limit) {
    for (const n of [sym, sym === "XAUUSDT" ? "PAXGUSDT" : "XAUUSDT"]) {
      try {
        const r = await fetch(SRC[n] + "&interval=" + iv + "&limit=" + limit);
        if (!r.ok) continue;
        const a = await r.json();
        if (!Array.isArray(a) || !a.length) continue;
        sym = n;
        return a.map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] }));
      } catch (e) { /* next source */ }
    }
    return null;
  }

  // ---------- alarm ----------
  let ac = null, osc = null, gain = null, sirenT = 0, vibT = 0, titleT = 0, testT = 0;
  const baseTitle = document.title;
  function initAudio() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      ac.onstatechange = updateStatus;
    }
    if (ac.state === "suspended") ac.resume();
  }
  function startSiren() {
    stopSiren();
    if (!ac) return;
    osc = ac.createOscillator(); gain = ac.createGain();
    osc.type = "square"; osc.frequency.value = 880;
    gain.gain.value = Math.min(1, Math.max(0, set.vol)) * 0.5;
    osc.connect(gain); gain.connect(ac.destination); osc.start();
    let hi = false;
    sirenT = setInterval(() => { hi = !hi; try { osc.frequency.setValueAtTime(hi ? 880 : 660, ac.currentTime); } catch (e) {} }, 350);
  }
  function stopSiren() {
    clearInterval(sirenT);
    if (osc) { try { osc.stop(); osc.disconnect(); } catch (e) {} osc = null; }
  }
  const vibrate = (p) => { if (set.vib && navigator.vibrate) { try { navigator.vibrate(p); } catch (e) {} } };

  function ring(title, body, levelId) {
    if (!armed) return;
    $("alarmText").textContent = title + ": " + body;
    $("alarmBanner").hidden = false;
    ringing = true; $("alarmBanner").dataset.level = levelId || "";
    clearTimeout(testT);
    startSiren();
    vibrate([400, 200, 400, 200, 400]);
    clearInterval(vibT); vibT = setInterval(() => vibrate([400, 200, 400, 200, 400]), 2200);
    clearInterval(titleT); let f = false;
    titleT = setInterval(() => { f = !f; document.title = f ? "ALERT " + title : baseTitle; }, 800);
    if (set.notify && "Notification" in window && Notification.permission === "granted") {
      try { new Notification(title, { body, tag: "xl-alert", renotify: true }); } catch (e) {}
    }
    if (set.ntfy) {
      try { fetch("https://ntfy.sh/" + encodeURIComponent(set.ntfy), { method: "POST", body: title + ": " + body }); } catch (e) {}
    }
  }
  function silence() {
    ringing = false; stopSiren();
    clearInterval(vibT); clearInterval(titleT); document.title = baseTitle;
    if (navigator.vibrate) { try { navigator.vibrate(0); } catch (e) {} }
    $("alarmBanner").hidden = true;
  }
  $("dismissBtn").addEventListener("click", silence);
  $("snoozeBtn").addEventListener("click", () => {
    const id = $("alarmBanner").dataset.level;
    if (id) st(id).snooze = Date.now() + 15 * 60000;
    silence();
  });

  let wl = null;
  async function wake() {
    try { if (navigator.wakeLock && armed) wl = await navigator.wakeLock.request("screen"); } catch (e) {}
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && armed) wake(); });

  async function arm() {
    if (armed) { armed = false; silence(); try { if (wl) wl.release(); } catch (e) {} wl = null; updateStatus(); return; }
    initAudio();
    if (set.notify && "Notification" in window && Notification.permission === "default") {
      try { Notification.requestPermission(); } catch (e) {}
    }
    armed = true;
    updateStatus();
    if (ac) { try { await ac.resume(); } catch (e) {} }
    await wake();
    if (ac && ac.state === "running") { // short blip proves sound works
      const o = ac.createOscillator(), g = ac.createGain();
      g.gain.value = 0.1; o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.15);
    }
    updateStatus();
  }
  function test() {
    initAudio(); startSiren(); vibrate([300, 100, 300]);
    clearTimeout(testT); testT = setTimeout(() => { if (!ringing) stopSiren(); }, 3000);
  }
  function updateStatus() {
    $("armBtn").textContent = armed ? "Disarm alarms" : "Arm alarms";
    $("armStatus").textContent = !armed ? "Not armed" : (ac && ac.state === "running" ? "Armed" : "Armed but sound blocked");
    $("armStatus").className = armed ? (ac && ac.state === "running" ? "ok" : "warn") : "muted";
  }
  $("armBtn").addEventListener("click", arm);
  $("testBtn").addEventListener("click", test);

  // ---------- log ----------
  function logEv(type, text) {
    log.unshift({ t: Date.now(), type, text });
    log = log.slice(0, 50); lsSet("xl_log", log); renderLog();
  }
  function renderLog() {
    const ul = $("logList"); ul.innerHTML = "";
    if (!log.length) { const li = document.createElement("li"); li.textContent = "No alerts yet."; li.className = "muted"; ul.appendChild(li); return; }
    for (const e of log) {
      const li = document.createElement("li");
      const a = document.createElement("span"); a.className = "muted"; a.textContent = kenya(e.t);
      const b = document.createElement("span"); b.textContent = e.type + ": " + e.text;
      li.append(a, b); ul.appendChild(li);
    }
  }
  $("logClear").addEventListener("click", () => { log = []; lsSet("xl_log", log); renderLog(); });

  // ---------- touches ----------
  function checkTouches(m1) {
    const fresh = last1m ? m1.filter((c) => c.t >= last1m) : m1.slice(-2);
    last1m = m1[m1.length - 1].t;
    const p = price || m1[m1.length - 1].c, b = set.band / 100, now = Date.now();
    for (const lv of levels) {
      const s = st(lv.id);
      if (s.cool && Math.abs(p - lv.price) / lv.price >= 0.003) s.cool = false;
      if (s.cool || !armed || set.levels[lv.id] === false || now < s.snooze) continue;
      const zlo = lv.price * (1 - b), zhi = lv.price * (1 + b);
      if (fresh.some((c) => c.h >= zlo && c.l <= zhi)) {
        s.cool = true;
        const txt = lv.label + " at " + fp(lv.price) + ", price " + fp(p);
        logEv("Touch", txt);
        ring("Level touched", txt, lv.id);
      }
    }
  }

  // ---------- signal ----------
  function evaluate(c) {
    const b = set.band / 100, buf = set.buf / 100, em = L.expected_move_1sd || 0;
    const range = c.h - c.l, lowW = Math.min(c.o, c.c) - c.l, upW = c.h - Math.max(c.o, c.c);
    const mean = c.c > L.gamma_flip;
    const cands = [];
    for (const lv of levels) {
      const zlo = lv.price * (1 - b), zhi = lv.price * (1 + b);
      const touched = c.h >= zlo && c.l <= zhi;
      let side = null, mode = "", reason = "";
      if (lv.kind === "flip") {
        if (touched && (c.c > zhi || c.c < zlo)) {
          side = c.c > zhi ? "BUY" : "SELL"; mode = "flip";
          reason = "5m candle closed clearly " + (side === "BUY" ? "above" : "below") + " the gamma flip.";
        }
      } else if (mean) {
        if (lv.kind === "sup" && touched && c.c > zhi && range > 0 && lowW >= 0.4 * range) {
          side = "BUY"; mode = "fade"; reason = "Rejection at " + lv.label + ": 5m candle closed back above the zone with a long lower wick.";
        }
        if (lv.kind === "res" && touched && c.c < zlo && range > 0 && upW >= 0.4 * range) {
          side = "SELL"; mode = "fade"; reason = "Rejection at " + lv.label + ": 5m candle closed back below the zone with a long upper wick.";
        }
      } else {
        if (lv.kind === "sup" && c.c < zlo && c.o >= zlo) { side = "SELL"; mode = "break"; reason = "5m candle closed below " + lv.label + " (breakout)."; }
        if (lv.kind === "res" && c.c > zhi && c.o <= zhi) { side = "BUY"; mode = "break"; reason = "5m candle closed above " + lv.label + " (breakout)."; }
      }
      if (side) cands.push({ lv, side, mode, reason });
    }
    cands.sort((a, b2) => Math.abs(a.lv.price - c.c) - Math.abs(b2.lv.price - c.c));
    const regime = mean ? "Mean-reverting: fade the levels" : "Volatile: below flip, favor breakouts";
    for (const k of cands) {
      const entry = c.c, side = k.side, minRisk = 0.25 * em;
      const sl = side === "BUY" ? Math.min(k.lv.price * (1 - buf), entry - minRisk) : Math.max(k.lv.price * (1 + buf), entry + minRisk);
      const risk = Math.abs(entry - sl);
      const prices = [...new Set(levels.map((l) => l.price))].sort((x, y) => x - y);
      const ahead = side === "BUY" ? prices.filter((p) => p > entry * 1.0005) : prices.filter((p) => p < entry * 0.9995).reverse();
      let tp1 = ahead[0], tp2 = ahead[1];
      if (tp1 === undefined) { tp1 = side === "BUY" ? entry + em : entry - em; tp2 = undefined; }
      const rr = risk > 0 ? Math.abs(tp1 - entry) / risk : 0;
      if (rr < set.minRR) { lastWait = "Risk to reward too low (" + rr.toFixed(2) + ", need " + set.minRR + "). " + side + " setup at " + k.lv.label + " skipped."; continue; }
      return { side, entry, sl, tp1, tp2, rr, level: k.lv.label, levelPrice: k.lv.price, levelId: k.lv.id, regime,
               reason: k.reason, t0: c.t + 300000, firedAt: Date.now(), status: "Active" };
    }
    return null;
  }

  function evalSignal(m5) {
    const c = m5.length > 1 ? m5[m5.length - 2] : null; // last candle is still open
    if (!c || c.t <= last5m) return;
    last5m = c.t;
    if (sig && sig.status === "Active") return;
    if (Date.now() - (c.t + 300000) > 600000) return; // too old to act on
    const s = evaluate(c);
    if (!s) return;
    sig = s; lastWait = ""; lsSet("xl_sig", sig);
    if (window.XChart) XChart.setSignal(sig);
    const txt = s.side + " at " + fp(s.entry) + ", SL " + fp(s.sl) + ", TP " + fp(s.tp1);
    logEv("Signal", txt + " (" + s.level + ")");
    ring(s.side + " signal", txt, s.levelId);
  }

  function closeSig(result) {
    logEv("Closed", sig.side + " " + fp(sig.entry) + ": " + result);
    lastWait = "Last signal closed: " + result + ".";
    sig = null; lsSet("xl_sig", null);
    if (window.XChart) XChart.setSignal(null);
  }
  function checkSignalClose(m1) {
    if (!sig || sig.status !== "Active") return;
    for (const c of m1) {
      if (c.t < sig.t0) continue;
      const buy = sig.side === "BUY";
      if (buy ? c.l <= sig.sl : c.h >= sig.sl) return closeSig("stop loss hit");
      if (buy ? c.h >= sig.tp1 : c.l <= sig.tp1) return closeSig("TP1 hit");
    }
    if (Date.now() - sig.t0 > 4 * 3600000) closeSig("expired after 4 hours");
  }

  async function poll() {
    if (busy || !levels.length || (document.hidden && !armed)) return;
    busy = true;
    try {
      const [m1, m5] = await Promise.all([kl("1m", catchup ? 500 : 5), kl("5m", 4)]);
      if (m1) {
        catchup = false;
        if (!price) price = m1[m1.length - 1].c;
        checkSignalClose(m1);
        checkTouches(m1);
      }
      if (m5) evalSignal(m5);
    } catch (e) { /* keep running */ }
    busy = false;
    render();
  }

  // ---------- ui ----------
  function render() {
    const card = $("sig");
    const regime = price && L ? (price > L.gamma_flip ? "Regime: mean-reverting, fade the levels" : "Regime: volatile below flip, favor breakouts") : "";
    $("sigRegime").textContent = regime;
    if (sig && sig.status === "Active") {
      card.className = "sig " + (sig.side === "BUY" ? "buy" : "sell");
      $("sigBadge").textContent = sig.side;
      $("sigReason").textContent = sig.reason;
      $("sigEntry").textContent = fp(sig.entry); $("sigSl").textContent = fp(sig.sl);
      $("sigTp1").textContent = fp(sig.tp1); $("sigTp2").textContent = sig.tp2 ? fp(sig.tp2) : "--";
      $("sigRr").textContent = "1:" + sig.rr.toFixed(2);
      $("sigMeta").textContent = "Active since " + kenya(sig.firedAt) + ". Trigger: " + sig.level + " " + fp(sig.levelPrice) + ". Expires after 4 hours.";
    } else {
      card.className = "sig wait";
      $("sigBadge").textContent = "WAIT";
      const b = set.band / 100;
      const inFlip = price && L && Math.abs(price - L.gamma_flip) <= L.gamma_flip * b;
      $("sigReason").textContent = inFlip ? "Inside gamma flip zone, watch reaction." : (lastWait || "Waiting for a level touch and a confirmation candle.");
      ["sigEntry", "sigSl", "sigTp1", "sigTp2", "sigRr"].forEach((i) => { $(i).textContent = "--"; });
      $("sigMeta").textContent = "";
    }
    $("chartSig").textContent = sig && sig.status === "Active"
      ? sig.side + " " + fp(sig.entry) + "  |  SL " + fp(sig.sl) + "  |  TP1 " + fp(sig.tp1)
      : "No active signal";
  }

  function buildChecks() {
    const box = $("levelChecks"); box.innerHTML = "";
    levels.forEach((lv) => {
      const lab = document.createElement("label"), cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = set.levels[lv.id] !== false;
      cb.addEventListener("change", () => { set.levels[lv.id] = cb.checked; save(); });
      lab.append(cb, " " + lv.label + " " + fp(lv.price)); box.appendChild(lab);
    });
  }
  const num = (id, key, min, max) => {
    const el = $(id); el.value = set[key];
    el.addEventListener("change", () => { const v = parseFloat(el.value); if (!isNaN(v) && v >= min && v <= max) set[key] = v; el.value = set[key]; save(); });
  };
  num("setBand", "band", 0.01, 2); num("setBuf", "buf", 0.01, 3); num("setRr", "minRR", 0.5, 10);
  num("setVol", "vol", 0, 1);
  [["setVib", "vib"], ["setNotify", "notify"]].forEach(([id, key]) => {
    $(id).checked = !!set[key]; $(id).addEventListener("change", () => { set[key] = $(id).checked; save(); });
  });
  $("setNtfy").value = set.ntfy || "";
  $("setNtfy").addEventListener("change", () => { set.ntfy = $("setNtfy").value.trim(); save(); });

  window.XAlerts = {
    setPrice(p) { price = p; render(); },
    setLevels(data) {
      const first = !levels.length;
      L = data; levels = [];
      const add = (id, label, p, kind) => levels.push({ id, label, price: p, kind });
      add("call", "Call wall", L.call_wall.price, "res");
      add("put", "Put wall", L.put_wall.price, "sup");
      add("flip", "Gamma flip", L.gamma_flip, "flip");
      L.resistances.forEach((o, i) => add("R" + (i + 1), "R" + (i + 1), o.price, "res"));
      L.supports.forEach((o, i) => add("S" + (i + 1), "S" + (i + 1), o.price, "sup"));
      buildChecks(); render();
      if (first) poll();
    }
  };

  renderLog(); updateStatus(); render();
  if (sig && window.XChart) XChart.setSignal(sig);
  setInterval(poll, 5000);
})();
