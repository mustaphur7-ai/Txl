// Live candlestick chart drawn on a plain canvas. No libraries, no CDN.
(function () {
  const C = { bg: "#0e1116", grid: "#1e2530", text: "#8b949e", up: "#26a69a", down: "#ef5350", amber: "#f5b942", white: "#e6e8ea" };
  const TFS = ["1m", "5m", "15m", "1h", "4h"];
  const SRC = {
    XAUUSDT: "https://fapi.binance.com/fapi/v1/klines?symbol=XAUUSDT",
    PAXGUSDT: "https://api.binance.com/api/v3/klines?symbol=PAXGUSDT"
  };
  const S = { tf: "5m", candles: [], levels: [], price: null, symbol: "XAUUSDT", offset: 0, vis: 80,
              cross: null, err: false, loading: true, token: 0 };
  const wrap = document.getElementById("chartWrap");
  const cv = document.getElementById("chart");
  const ctx = cv.getContext("2d");
  const msg = document.getElementById("chartMsg");
  const jump = document.getElementById("jumpNow");
  const info = document.getElementById("chartInfo");
  const bar = document.getElementById("tfBar");
  const padL = 4, padR = 64, padT = 8, padB = 24;
  let W = 0, H = 0, dpr = 1, raf = 0;

  const fT = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", hour12: false });
  const fD = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const fmtAxis = (t) => (S.tf === "1h" || S.tf === "4h" ? fD : fT).format(new Date(t));
  const fp = (n) => n.toFixed(2);

  // ---------- data ----------
  async function fetchKlines(tf, limit) {
    const order = [S.symbol, S.symbol === "XAUUSDT" ? "PAXGUSDT" : "XAUUSDT"];
    for (const name of order) {
      try {
        const r = await fetch(SRC[name] + "&interval=" + tf + "&limit=" + limit);
        if (!r.ok) continue;
        const a = await r.json();
        if (!Array.isArray(a) || !a.length) continue;
        S.symbol = name;
        return a.map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] }));
      } catch (e) { /* try next source */ }
    }
    return null;
  }

  async function load() {
    const tok = ++S.token, tf = S.tf;
    S.loading = true; S.candles = []; S.offset = 0; S.cross = null;
    updateUI(); draw();
    const d = await fetchKlines(tf, 300);
    if (tok !== S.token) return;
    S.loading = false;
    if (d) { S.candles = d; S.err = false; }
    else { S.err = true; setTimeout(() => { if (tok === S.token) load(); }, 4000); }
    updateUI(); draw();
  }

  async function poll() {
    if (document.hidden || S.loading || !S.candles.length) return;
    const tok = S.token, tf = S.tf;
    const d = await fetchKlines(tf, 2);
    if (tok !== S.token) return;
    if (!d) { S.err = true; updateUI(); return; }
    S.err = false;
    for (const k of d) {
      const last = S.candles[S.candles.length - 1];
      if (k.t === last.t) S.candles[S.candles.length - 1] = k;
      else if (k.t > last.t) { S.candles.push(k); if (S.offset > 0) S.offset += 1; }
    }
    if (S.candles.length > 500) S.candles.splice(0, S.candles.length - 500);
    updateUI(); draw();
  }

  // ---------- drawing ----------
  function clampView() {
    const n = S.candles.length;
    S.vis = Math.min(Math.max(S.vis, 15), Math.min(400, Math.max(n, 15)));
    S.offset = Math.min(Math.max(S.offset, 0), Math.max(0, n - 10));
  }
  function draw() { if (!raf) raf = requestAnimationFrame(render); }

  function render() {
    raf = 0;
    if (!W) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    const n = S.candles.length;
    if (!n) return;
    clampView();
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const end = n - S.offset, start = end - S.vis, cw = plotW / S.vis;
    const i0 = Math.max(0, Math.floor(start)), i1 = Math.min(n - 1, Math.ceil(end) - 1);
    let lo = Infinity, hi = -Infinity;
    for (let i = i0; i <= i1; i++) { lo = Math.min(lo, S.candles[i].l); hi = Math.max(hi, S.candles[i].h); }
    const ref = S.price || S.candles[n - 1].c;
    for (const L of S.levels) if (Math.abs(L.price - ref) / ref <= 0.03) { lo = Math.min(lo, L.price); hi = Math.max(hi, L.price); }
    const pad = (hi - lo) * 0.05 || 1; lo -= pad; hi += pad;
    const y = (p) => padT + ((hi - p) / (hi - lo)) * plotH;
    const x = (i) => padL + (i - start + 0.5) * cw;

    ctx.font = "11px system-ui, sans-serif";
    const axisLabels = [];
    ctx.save();
    ctx.beginPath(); ctx.rect(padL, padT, plotW, plotH); ctx.clip();

    // grid
    const raw = (hi - lo) / 5, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].find((m) => m * mag >= raw) * mag;
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.setLineDash([]);
    for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) {
      const yy = Math.round(y(p)) + 0.5;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
      axisLabels.push([p, yy]);
    }

    // candles
    const bw = Math.max(1, cw * 0.7);
    for (let i = i0; i <= i1; i++) {
      const k = S.candles[i], up = k.c >= k.o, col = up ? C.up : C.down, cx = x(i);
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, y(k.h)); ctx.lineTo(cx, y(k.l)); ctx.stroke();
      const top = y(Math.max(k.o, k.c)), h = Math.max(1, Math.abs(y(k.o) - y(k.c)));
      ctx.fillRect(cx - bw / 2, top, bw, h);
    }

    // level lines
    const vis = S.levels.filter((L) => L.price >= lo && L.price <= hi).sort((a, b) => b.price - a.price);
    for (const L of vis) {
      ctx.strokeStyle = L.color; ctx.lineWidth = 1; ctx.setLineDash(L.dash ? [6, 4] : []);
      const yy = Math.round(y(L.price)) + 0.5;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
    }
    ctx.setLineDash([]);
    const ly = vis.map((L) => y(L.price));
    for (let k = 1; k < ly.length; k++) if (ly[k] - ly[k - 1] < 14) ly[k] = ly[k - 1] + 14;
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    vis.forEach((L, k) => {
      const t = L.label + " " + fp(L.price), w = ctx.measureText(t).width + 8;
      ctx.fillStyle = "rgba(14,17,22,0.85)"; ctx.fillRect(W - padR - 4 - w, ly[k] - 7, w, 14);
      ctx.fillStyle = L.color; ctx.fillText(t, W - padR - 8, ly[k]);
    });

    // current price line
    const py = Math.min(Math.max(y(ref), padT), padT + plotH);
    ctx.strokeStyle = C.white; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(padL, py); ctx.lineTo(W - padR, py); ctx.stroke();
    ctx.setLineDash([]);

    // crosshair lines
    let cinfo = null;
    if (S.cross) {
      const cx = Math.min(Math.max(S.cross.x, padL), W - padR), cy = Math.min(Math.max(S.cross.y, padT), padT + plotH);
      ctx.strokeStyle = C.text; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(cx, padT); ctx.lineTo(cx, padT + plotH); ctx.moveTo(padL, cy); ctx.lineTo(W - padR, cy); ctx.stroke();
      ctx.setLineDash([]);
      const idx = Math.min(n - 1, Math.max(0, Math.floor(start + (cx - padL) / cw)));
      cinfo = { cx, cy, p: hi - ((cy - padT) / plotH) * (hi - lo), k: S.candles[idx] };
    }
    ctx.restore();

    // price axis
    ctx.fillStyle = C.text; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    for (const [p, yy] of axisLabels) ctx.fillText(fp(p), W - padR + 6, yy);
    const tag = (txt, yy, bg, fg) => {
      ctx.fillStyle = bg; ctx.fillRect(W - padR + 1, yy - 8, padR - 2, 16);
      ctx.fillStyle = fg; ctx.textAlign = "left"; ctx.fillText(txt, W - padR + 5, yy);
    };
    tag(fp(ref), py, C.white, C.bg);

    // time axis
    ctx.fillStyle = C.text; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const every = Math.max(1, Math.round(S.vis / 5));
    for (let i = Math.ceil(start); i < end; i++) {
      if (i < 0 || i >= n || i % every) continue;
      const xx = x(i);
      if (xx > padL + 20 && xx < W - padR - 20) ctx.fillText(fmtAxis(S.candles[i].t), xx, H - padB / 2);
    }

    if (cinfo) {
      tag(fp(cinfo.p), cinfo.cy, C.grid, C.white);
      const k = cinfo.k, t = fD.format(new Date(k.t));
      const txt = t + "  O " + fp(k.o) + "  H " + fp(k.h) + "  L " + fp(k.l) + "  C " + fp(k.c);
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      const w = ctx.measureText(txt).width + 10;
      ctx.fillStyle = "rgba(22,27,34,0.92)"; ctx.fillRect(padL + 2, padT + 2, w, 18);
      ctx.fillStyle = C.white; ctx.fillText(txt, padL + 7, padT + 11);
    }
  }

  // ---------- ui ----------
  function updateUI() {
    info.textContent = "Binance " + S.symbol + " " + S.tf + (S.err && S.candles.length ? " (reconnecting)" : "");
    const none = !S.candles.length;
    msg.hidden = !none;
    msg.textContent = S.err ? "Chart data unavailable, retrying" : "Loading chart";
    jump.hidden = S.offset < 0.5;
    [...bar.children].forEach((b) => b.classList.toggle("on", b.dataset.tf === S.tf));
  }
  TFS.forEach((tf) => {
    const b = document.createElement("button");
    b.textContent = tf; b.dataset.tf = tf; b.type = "button";
    b.addEventListener("click", () => { if (S.tf !== tf) { S.tf = tf; load(); } });
    bar.appendChild(b);
  });
  jump.addEventListener("click", () => { S.offset = 0; updateUI(); draw(); });

  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = wrap.clientWidth; H = wrap.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    draw();
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(wrap);
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => setTimeout(resize, 150));

  // ---------- touch and mouse ----------
  const ptrs = new Map();
  let drag = null, pinch = null, lp = 0, crossMode = false;
  const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const dist = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };

  cv.addEventListener("pointerdown", (e) => {
    try { cv.setPointerCapture(e.pointerId); } catch (_) {}
    const p = pos(e); ptrs.set(e.pointerId, p);
    if (ptrs.size === 1) {
      drag = { x: p.x, y: p.y, off: S.offset, moved: false };
      clearTimeout(lp);
      if (e.pointerType !== "mouse") {
        lp = setTimeout(() => {
          if (drag && !drag.moved && ptrs.size === 1) { crossMode = true; S.cross = { x: drag.x, y: drag.y }; draw(); }
        }, 350);
      }
    } else if (ptrs.size === 2) {
      clearTimeout(lp); crossMode = false; S.cross = null; drag = null;
      pinch = { d: dist(), vis: S.vis };
    }
  });
  cv.addEventListener("pointermove", (e) => {
    const p = pos(e);
    if (!ptrs.has(e.pointerId)) { if (e.pointerType === "mouse") { S.cross = p; draw(); } return; }
    ptrs.set(e.pointerId, p);
    if (ptrs.size === 2 && pinch) { S.vis = (pinch.vis * pinch.d) / dist(); draw(); return; }
    if (!drag) return;
    if (crossMode) { S.cross = p; draw(); return; }
    const dx = p.x - drag.x;
    if (Math.abs(dx) > 6 || Math.abs(p.y - drag.y) > 6) drag.moved = true;
    if (drag.moved) {
      clearTimeout(lp);
      S.offset = drag.off + dx / ((W - padL - padR) / S.vis);
      if (e.pointerType === "mouse") S.cross = p;
      updateUI(); draw();
    }
  });
  const up = (e) => {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (ptrs.size === 0) {
      drag = null; clearTimeout(lp); crossMode = false;
      if (e.pointerType !== "mouse") S.cross = null;
      updateUI(); draw();
    } else if (ptrs.size === 1) drag = null;
  };
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", up);
  cv.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && !ptrs.size) { S.cross = null; draw(); } });
  cv.addEventListener("wheel", (e) => { e.preventDefault(); S.vis *= e.deltaY > 0 ? 1.12 : 0.89; draw(); }, { passive: false });
  cv.addEventListener("touchmove", (e) => { if (crossMode) e.preventDefault(); }, { passive: false });
  cv.addEventListener("contextmenu", (e) => e.preventDefault());

  // ---------- public API used by app.js ----------
  window.XChart = {
    setPrice(p) { S.price = p; draw(); },
    setLevels(L) {
      const R = C.down, G = C.up, A = C.amber, lv = [];
      lv.push({ label: "Call wall", price: L.call_wall.price, color: R, dash: false });
      lv.push({ label: "Put wall", price: L.put_wall.price, color: G, dash: false });
      lv.push({ label: "Flip", price: L.gamma_flip, color: A, dash: false });
      L.resistances.forEach((o, i) => lv.push({ label: "R" + (i + 1), price: o.price, color: R, dash: true }));
      L.supports.forEach((o, i) => lv.push({ label: "S" + (i + 1), price: o.price, color: G, dash: true }));
      S.levels = lv; draw();
    }
  };

  resize(); updateUI(); load();
  setInterval(poll, 5000);
})();
