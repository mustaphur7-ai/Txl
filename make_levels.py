"""Daily BTC options analysis. Writes levels.json only on success."""
import json, math, os, sys, time, urllib.request
from datetime import datetime, timezone, timedelta

DERIBIT = "https://www.deribit.com/api/v2/public/"
RATE = 0.04

def get(url):
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "btc-levels"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(3 * (attempt + 1))

def spot_price():
    sources = [
        ("deribit", DERIBIT + "get_index_price?index_name=btc_usd", lambda d: d["result"]["index_price"]),
        ("binance", "https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT", lambda d: d["price"]),
        ("coinbase", "https://api.coinbase.com/v2/prices/BTC-USD/spot", lambda d: d["data"]["amount"]),
    ]
    for name, url, pick in sources:
        try:
            value = float(pick(get(url)))
            if value > 0:
                return value, name
        except Exception as e:
            print(f"{name} failed: {e}", file=sys.stderr)
    raise RuntimeError("no spot source available")

def greeks(s, k, t, v, call):
    d1 = (math.log(s / k) + (RATE + v * v / 2) * t) / (v * math.sqrt(t))
    pdf = math.exp(-d1 * d1 / 2) / math.sqrt(2 * math.pi)
    cdf = (1 + math.erf(d1 / math.sqrt(2))) / 2
    return (cdf if call else cdf - 1, pdf / (s * v * math.sqrt(t)), s * pdf * math.sqrt(t) / 100)

def load_options(now):
    ins = get(DERIBIT + "get_instruments?currency=BTC&kind=option&expired=false")["result"]
    book = get(DERIBIT + "get_book_summary_by_currency?currency=BTC&kind=option")["result"]
    meta = {i["instrument_name"]: i for i in ins}
    rows = []
    for b in book:
        m = meta.get(b["instrument_name"])
        oi, iv = b.get("open_interest") or 0, b.get("mark_iv") or 0
        if not m or oi <= 0 or iv <= 0:
            continue
        secs = m["expiration_timestamp"] / 1000 - now.timestamp()
        if 0 < secs <= 30 * 86400:
            rows.append({"k": float(m["strike"]), "call": m["option_type"] == "call", "oi": oi,
                         "iv": iv / 100, "t": max(secs / 86400, 0.5) / 365})
    if len(rows) < 20:
        raise RuntimeError(f"only {len(rows)} usable options")
    return rows

def total_gex(rows, s):
    return sum((1 if r["call"] else -1) * greeks(s, r["k"], r["t"], r["iv"], r["call"])[1]
               * r["oi"] * s * s * 0.01 for r in rows)

def gamma_flip(rows, spot):
    grid = [spot * (0.9 + 0.001 * i) for i in range(201)]
    vals = [total_gex(rows, s) for s in grid]
    cross = [a - va * (b - a) / (vb - va)
             for a, b, va, vb in zip(grid, grid[1:], vals, vals[1:]) if va * vb < 0]
    if cross:
        return min(cross, key=lambda x: abs(x - spot))
    return min(zip(grid, vals), key=lambda p: abs(p[1]))[0]

def by_strike(rows, spot):
    out = {}
    for r in rows:
        x = out.setdefault(r["k"], dict(strike=r["k"], call_oi=0, put_oi=0, call_gex=0, put_gex=0,
                                        net_delta=0, vega=0, ivs=[]))
        d, g, v = greeks(spot, r["k"], r["t"], r["iv"], r["call"])
        side = "call" if r["call"] else "put"
        x[side + "_oi"] += r["oi"]
        x[side + "_gex"] += (1 if r["call"] else -1) * g * r["oi"] * spot * spot * 0.01
        x["net_delta"] += d * r["oi"]
        x["vega"] += v * r["oi"]
        x["ivs"].append(r["iv"])
    for x in out.values():
        x["iv"] = sum(x["ivs"]) / len(x.pop("ivs"))
        x["gex"] = x["call_gex"] + x["put_gex"]
    return out

def pick_levels(strikes, spot, move, atm, keys, above):
    side = "call" if above else "put"
    on_side = lambda p: p > spot if above else p < spot
    bounds = [spot + n * move for n in (-2, -1, 1, 2)]
    prices = {k for k in strikes if abs(k / spot - 1) <= 0.08} | set(bounds)
    cands = []
    for p in filter(on_side, prices):
        x = strikes[min(strikes, key=lambda k: abs(k - p))]  # nearest strike's data
        cands.append(dict(price=p, oi=x[side + "_oi"], gex=x[side + "_gex"],
                          delta=abs(x["net_delta"]), vega=x["vega"], skew=abs(x["iv"] - atm)))
    if not cands:
        raise RuntimeError("no candidates")
    top = {f: max(abs(c[f]) for c in cands) or 1 for f in ("oi", "gex", "delta", "vega", "skew")}
    for c in cands:
        n = {f: abs(c[f]) / top[f] for f in top}
        near_em = max(0, 1 - min(abs(c["price"] - b) for b in bounds) / move)
        near_key = max(0, 1 - min(abs(c["price"] - k) for k in keys) / (spot * 0.08))
        c["score"] = (35 * n["oi"] + 25 * n["gex"] + 15 * (n["delta"] + n["vega"]) / 2
                      + 15 * (n["skew"] + near_em) / 2 + 10 * near_key)
    chosen = []
    for c in sorted(cands, key=lambda c: -c["score"]):
        if all(abs(c["price"] - o["price"]) >= spot * 0.003 for o in chosen):
            chosen.append(c)
        if len(chosen) == 3:
            break
    if len(chosen) < 3:
        raise RuntimeError("fewer than 3 levels on one side")
    chosen.sort(key=lambda c: abs(c["price"] - spot))
    return [dict(price=round(c["price"], 2), score=round(c["score"], 1),
                 open_interest=round(c["oi"], 1), gex=round(c["gex"])) for c in chosen]

def main():
    now = datetime.now(timezone.utc)
    spot, source = spot_price()
    rows = load_options(now)
    strikes = by_strike(rows, spot)
    first = min((r["t"] for r in rows if r["t"] >= 1 / 365), default=min(r["t"] for r in rows))
    near = [r for r in rows if r["t"] == first]
    atm_k = min((r["k"] for r in near), key=lambda k: abs(k - spot))
    ivs = [r["iv"] for r in near if r["k"] == atm_k]
    atm = sum(ivs) / len(ivs)
    move = spot * atm * math.sqrt(1 / 365)

    def wall(side, cands):
        cands = [x for x in cands if abs(x[side + "_gex"]) > 0]
        x = max(cands, key=lambda x: abs(x[side + "_gex"]))
        return dict(price=x["strike"], open_interest=round(x[side + "_oi"], 1), gex=round(x[side + "_gex"]))

    cw = wall("call", [x for k, x in strikes.items() if k > spot])
    pw = wall("put", [x for k, x in strikes.items() if k < spot])
    flip = round(gamma_flip(rows, spot), 2)
    keys = [cw["price"], pw["price"], flip]
    top = sorted(strikes.values(), key=lambda x: -abs(x["gex"]))[:10]
    data = dict(
        sample=False,
        analyzed_at=now.astimezone(timezone(timedelta(hours=3))).isoformat(timespec="seconds"),
        analyzed_at_utc=now.isoformat(timespec="seconds"),
        spot_source=source, spot_at_analysis=round(spot, 2),
        atm_iv=round(atm, 4), expected_move_1sd=round(move, 2),
        call_wall=cw, put_wall=pw, gamma_flip=flip,
        resistances=pick_levels(strikes, spot, move, atm, keys, True),
        supports=pick_levels(strikes, spot, move, atm, keys, False),
        top_gex_strikes=[{k: round(v, 4) for k, v in x.items()} for x in top],
    )
    with open("levels.json.tmp", "w") as f:
        json.dump(data, f, indent=2, allow_nan=False)
    os.replace("levels.json.tmp", "levels.json")
    print("levels.json written, spot", data["spot_at_analysis"])

if __name__ == "__main__":
    main()
