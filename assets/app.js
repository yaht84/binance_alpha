const state = {
  data: null,
  filter: "all",
  query: "",
  selected: null,
  busy: false,
};

const $ = (id) => document.getElementById(id);

function n(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pct(value) {
  if (value === undefined || value === null) return "-";
  const number = n(value);
  return `${number > 0 ? "+" : ""}${number.toFixed(Math.abs(number) >= 100 ? 0 : 1)}%`;
}

function money(value) {
  const number = n(value);
  if (!number) return "-";
  if (Math.abs(number) >= 1_000_000_000) return `$${(number / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(number) >= 1_000_000) return `$${(number / 1_000_000).toFixed(2)}M`;
  if (Math.abs(number) >= 1_000) return `$${(number / 1_000).toFixed(1)}K`;
  return `$${number.toFixed(0)}`;
}

function x(value) {
  if (value === undefined || value === null) return "-";
  return `${n(value).toFixed(n(value) >= 10 ? 1 : 2)}x`;
}

function scoreClass(score) {
  if (score >= 75) return "high";
  if (score >= 50) return "mid";
  return "";
}

function trend(value) {
  return n(value) >= 0 ? "pos" : "neg";
}

function rows() {
  if (!state.data) return [];
  const query = state.query.trim().toUpperCase();
  return state.data.records
    .filter((item) => item.futures && item.futures.symbol)
    .filter((item) => {
      if (state.filter === "signal") return item.signal;
      if (state.filter === "candidate") return item.cohort !== "pumped";
      if (state.filter === "pumped") return item.cohort === "pumped";
      return true;
    })
    .filter((item) => {
      if (!query) return true;
      return item.token.includes(query) || (item.futures && item.futures.symbol.includes(query));
    })
    .sort((a, b) => b.score - a.score);
}

async function loadLive() {
  if (state.busy) return;
  state.busy = true;
  $("statusText").textContent = "refreshing";
  $("liveDot").className = "";
  try {
    const loaded = await fetchData();
    state.data = loaded.data;
    if (!state.selected && state.data.records.length) {
      state.selected = state.data.summary.top[0]?.token || state.data.records[0].token;
    }
    $("statusText").textContent = loaded.source;
    $("liveDot").className = "ok";
    render();
  } catch (error) {
    $("statusText").textContent = error.message;
    $("liveDot").className = "err";
  } finally {
    state.busy = false;
  }
}

async function fetchData() {
  const ts = Date.now();
  const backend = window.BACKEND_URL ? String(window.BACKEND_URL).replace(/\/$/, "") : "";
  const endpoints = [
    ...(backend ? [{ url: `${backend}/api/live?ts=${ts}`, source: "backend live" }] : []),
    { url: `api/live?ts=${ts}`, source: "live api" },
    { url: `data/live.json?ts=${ts}`, source: "static live" },
  ];
  let lastError;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint.url, { cache: "no-store" });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return { data: await response.json(), source: endpoint.source };
    } catch (error) {
      lastError = error;
    }
  }
  return { data: await browserScan(), source: "browser Binance" };
}

const SEED_PUMPED = ["RIVER", "SIREN", "RAVE", "SOON", "POWER", "MYX", "ARIA"];
const SEED_CANDIDATES = ["IRYS", "XAN", "ON", "Q", "TA", "IDOL", "TUT", "GWEI", "TAC", "TAG"];
const FUTURES_BASE = "https://fapi.binance.com";
const BINANCE_BASE = "https://www.binance.com";

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function q(params) {
  return new URLSearchParams(params).toString();
}

function alphaSnapshot(item) {
  const marketCap = n(item.marketCap);
  const fdv = n(item.fdv);
  const liquidity = n(item.liquidity);
  const volume24h = n(item.volume24h);
  const holders = n(item.holders);
  return {
    alphaId: item.alphaId,
    name: item.name,
    symbol: String(item.symbol || "").toUpperCase(),
    chain: item.chainName,
    contract: item.contractAddress,
    price: n(item.price),
    change24h: n(item.percentChange24h),
    volume24h,
    marketCap,
    fdv,
    liquidity,
    holders: holders || null,
    volumeLiquidity: liquidity > 0 ? volume24h / liquidity : null,
    fdvMcap: marketCap > 0 ? fdv / marketCap : null,
    count24h: item.count24h === null || item.count24h === undefined ? null : n(item.count24h),
    hotTag: Boolean(item.hotTag),
    offline: Boolean(item.offline),
    fullyDelisted: Boolean(item.fullyDelisted),
    stockState: Boolean(item.stockState),
    cexCoinName: item.cexCoinName || "",
  };
}

function alphaPreScore(alpha) {
  if (!alpha || alpha.offline || alpha.fullyDelisted || alpha.stockState) return -1;
  let score = 0;
  if (alpha.volumeLiquidity !== null && alpha.volumeLiquidity >= 1) score += 25;
  if (alpha.volumeLiquidity !== null && alpha.volumeLiquidity >= 3) score += 20;
  if (alpha.liquidity > 0 && alpha.liquidity < 1_000_000) score += 18;
  if (alpha.marketCap > 0 && alpha.marketCap < 80_000_000) score += 14;
  if (alpha.fdvMcap !== null && alpha.fdvMcap > 3) score += 8;
  if (alpha.holders !== null && alpha.holders < 30_000) score += 8;
  if (Math.abs(alpha.change24h) > 12) score += 7;
  if (alpha.hotTag) score += 8;
  if (alpha.count24h !== null && alpha.count24h < 400) score += 4;
  return score;
}

function chooseAlphaMap(alphaList, tokens) {
  const bySymbol = new Map();
  alphaList.forEach((item) => {
    const snap = alphaSnapshot(item);
    if (!snap.symbol) return;
    [snap.symbol, String(item.cexCoinName || "").toUpperCase()].filter(Boolean).forEach((key) => {
      if (!bySymbol.has(key)) bySymbol.set(key, []);
      bySymbol.get(key).push(snap);
    });
  });
  const out = new Map();
  tokens.forEach((token) => {
    const matches = bySymbol.get(token) || [];
    matches.sort((a, b) => alphaPreScore(b) - alphaPreScore(a) || b.volume24h - a.volume24h);
    if (matches[0]) out.set(token, matches[0]);
  });
  return out;
}

function futuresBases(exchangeInfo) {
  return new Set(
    (exchangeInfo.symbols || [])
      .filter((item) => item.quoteAsset === "USDT" && ["PERPETUAL", "TRADIFI_PERPETUAL"].includes(item.contractType))
      .map((item) => String(item.baseAsset || "").toUpperCase())
      .filter(Boolean),
  );
}

function alphaUniverse(alphaList, seeds, maxTokens, allowedBases) {
  const seen = new Set(seeds);
  const rows = [];
  alphaList.forEach((item) => {
    const snap = alphaSnapshot(item);
    if (!/^[A-Z0-9]{1,15}$/.test(snap.symbol)) return;
    if (allowedBases && !allowedBases.has(snap.symbol)) return;
    if (seen.has(snap.symbol)) return;
    const score = alphaPreScore(snap);
    if (score < 25) return;
    rows.push({ token: snap.symbol, score, snap });
  });
  rows.sort((a, b) => b.score - a.score || b.snap.volume24h - a.snap.volume24h);
  return rows.slice(0, Math.max(0, maxTokens - seeds.length)).map((row) => row.token);
}

function chooseFuturesMap(exchangeInfo, tokens) {
  const byBase = new Map();
  (exchangeInfo.symbols || []).forEach((item) => {
    if (item.quoteAsset !== "USDT") return;
    if (!["PERPETUAL", "TRADIFI_PERPETUAL"].includes(item.contractType)) return;
    const base = String(item.baseAsset || "").toUpperCase();
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(item);
  });
  const out = new Map();
  tokens.forEach((token) => {
    const matches = byBase.get(token) || [];
    matches.sort((a, b) => (b.contractType === "PERPETUAL") - (a.contractType === "PERPETUAL"));
    if (matches[0]) out.set(token, matches[0]);
  });
  return out;
}

function parseKline(row) {
  return {
    t: n(row[0]),
    o: n(row[1]),
    h: n(row[2]),
    l: n(row[3]),
    c: n(row[4]),
    qv: n(row[7]),
    takerBuyQv: n(row[10]),
  };
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

function change(a, b) {
  return a > 0 ? b / a - 1 : 0;
}

function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function vol1hRatio(candles, periods = 4) {
  if (candles.length < periods * 6) return 0;
  const latest = candles.slice(-periods).reduce((sum, candle) => sum + n(candle.qv), 0);
  const windows = [];
  for (let end = periods; end <= candles.length - periods; end += periods) {
    const value = candles.slice(end - periods, end).reduce((sum, candle) => sum + n(candle.qv), 0);
    if (value > 0) windows.push(value);
  }
  const base = median(windows);
  return base > 0 ? latest / base : 0;
}

function pumpDumpMetric(candles) {
  if (!candles.length) return { pumpPct: 0, dumpPct: 0 };
  let lowBefore = n(candles[0].l) || n(candles[0].c);
  let highBefore = n(candles[0].h) || n(candles[0].c);
  let pumpPct = 0;
  let dumpPct = 0;
  candles.forEach((candle) => {
    const high = n(candle.h) || n(candle.c);
    const low = n(candle.l) || n(candle.c);
    if (lowBefore > 0 && high > 0) pumpPct = Math.max(pumpPct, change(lowBefore, high) * 100);
    if (highBefore > 0 && low > 0) dumpPct = Math.min(dumpPct, change(highBefore, low) * 100);
    if (low > 0) lowBefore = Math.min(lowBefore, low);
    if (high > 0) highBefore = Math.max(highBefore, high);
  });
  return { pumpPct, dumpPct };
}

function chartIntervalFor(item) {
  const onboardDate = n(item.futures && item.futures.onboardDate);
  if (!onboardDate) return { interval: "1d", startTime: null, label: "1d max-history preview" };
  const ageDays = Math.max(1, (Date.now() - onboardDate) / 86_400_000);
  if (ageDays <= 70) return { interval: "1h", startTime: onboardDate, label: "full history - 1h candles" };
  if (ageDays <= 250) return { interval: "4h", startTime: onboardDate, label: "full history - 4h candles" };
  if (ageDays <= 750) return { interval: "12h", startTime: onboardDate, label: "full history - 12h candles" };
  if (ageDays <= 1500) return { interval: "1d", startTime: onboardDate, label: "full history - 1d candles" };
  return { interval: "1w", startTime: onboardDate, label: "full history - 1w candles" };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function addScore(box, points, reason) {
  if (points <= 0) return;
  box.score += points;
  box.reasons.push(reason);
}

function bandScore(value, low, high, maxPoints) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= low && value <= high) return maxPoints;
  const mid = (low + high) / 2;
  const width = Math.max(high - low, 1e-9);
  return clamp(maxPoints * (1 - Math.abs(value - mid) / width), 0, maxPoints * 0.65);
}

function logBandScore(value, low, high, maxPoints) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= low && value <= high) return maxPoints;
  const lValue = Math.log(value);
  const lLow = Math.log(low);
  const lHigh = Math.log(high);
  const lMid = (lLow + lHigh) / 2;
  const width = Math.max(lHigh - lLow, 1e-9);
  return clamp(maxPoints * (1 - Math.abs(lValue - lMid) / width), 0, maxPoints * 0.65);
}

function windowRangePct(candles, limit) {
  const sample = candles.slice(-limit);
  const highs = sample.map((candle) => n(candle.h)).filter((value) => value > 0);
  const lows = sample.map((candle) => n(candle.l)).filter((value) => value > 0);
  if (!highs.length || !lows.length) return 0;
  return change(Math.min(...lows), Math.max(...highs)) * 100;
}

function classifyPattern(metrics, cohort) {
  if (cohort === "pumped") return "training cohort";
  if (metrics.pumpPct >= 350 && metrics.dumpPct <= -40) return "spent pnd";
  if (metrics.pumpPct >= 160 && metrics.dumpPct <= -45) return "post-pump risk";
  if (metrics.pumpPct >= 250 && metrics.drawdownFromHigh <= -30) return "post-pump risk";
  if (metrics.ret24h >= 60 || metrics.pumpPct >= 180) return "overextended";
  if (metrics.ret24h >= 10 || metrics.oi30d.changePct >= 35 || metrics.vol1hRatio >= 2.2) return "active setup";
  return "watch setup";
}

function scoreRecord(alpha, futures) {
  const reasons = [];
  const scoring = { score: 0, reasons };
  if (alpha) {
    if (alpha.volumeLiquidity !== null && alpha.volumeLiquidity >= 1) {
      addScore(scoring, 5, "alpha volume/liquidity above 1x");
    }
    if (alpha.volumeLiquidity !== null && alpha.volumeLiquidity >= 3) {
      addScore(scoring, 5, "alpha volume/liquidity above 3x");
    }
    if (alpha.liquidity > 0 && alpha.liquidity < 1_000_000) {
      addScore(scoring, 4, "thin alpha liquidity");
    }
    if (alpha.marketCap > 0 && alpha.marketCap < 80_000_000) {
      addScore(scoring, 3, "low market cap");
    }
    if (alpha.fdvMcap !== null && alpha.fdvMcap >= 3) {
      addScore(scoring, 2, "high FDV/MCAP");
    }
  }
  if (futures) {
    if (futures.vol1hRatio >= 2.2) {
      addScore(scoring, futures.vol1hRatio >= 7 ? 8 : 6, "1h futures volume breakout");
    }
    if (futures.vol24Ratio >= 2.5) {
      addScore(scoring, futures.vol24Ratio >= 7 ? 8 : 5, "24h futures volume resembles pump cohort");
    }
    if (futures.ret4h >= 4 && futures.ret4h <= 35) {
      addScore(scoring, 5, "early 4h momentum");
    }
    if (futures.ret24h >= 8 && futures.ret24h <= 65) {
      addScore(scoring, 5, "24h momentum before vertical stage");
    }
    if (futures.oi && futures.oi.changePct >= 25) {
      addScore(scoring, 5, "short-window open interest expanding");
    }
    if (futures.oi30d && futures.oi30d.changePct >= 25) {
      addScore(scoring, futures.oi30d.changePct >= 80 ? 8 : 5, "30d open interest expansion");
    }
    addScore(scoring, logBandScore(alpha && alpha.volumeLiquidity, 1.4, 6.5, 6), "alpha volume/liquidity matches PND cohort");
    addScore(scoring, logBandScore(alpha && alpha.liquidity, 25_000, 1_200_000, 4), "thin liquidity matches PND cohort");
    addScore(scoring, logBandScore(alpha && alpha.marketCap, 3_000_000, 120_000_000, 4), "market cap in PND cohort band");
    addScore(scoring, bandScore(futures.range7d, 45, 260, 5), "7d range resembles pre-pump volatility");
    addScore(scoring, logBandScore(futures.vol24Ratio, 3, 12, 6), "24h volume spike near cohort fingerprint");
    addScore(scoring, bandScore(futures.ret72h, 10, 160, 4), "multi-day momentum resembles setup phase");
    const pattern = classifyPattern(futures, futures.cohort);
    futures.pattern = pattern;
    if (futures.cohort !== "pumped") {
      if (pattern === "spent pnd") {
        scoring.score -= 45;
        reasons.push("penalty: already shows full pump-and-dump footprint");
      } else if (pattern === "post-pump risk") {
        scoring.score -= 36;
        reasons.push("penalty: looks post-pump, not pre-pump");
      } else if (pattern === "overextended") {
        scoring.score -= 22;
        reasons.push("penalty: move is already overextended");
      }
    }
  }
  return { score: clamp(Math.round(scoring.score), 0, 100), reasons };
}

async function browserScan() {
  const [exchangeInfo, alphaPayload] = await Promise.all([
    getJson(`${FUTURES_BASE}/fapi/v1/exchangeInfo`),
    getJson(`${BINANCE_BASE}/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list`),
  ]);
  const alphaList = alphaPayload.data || [];
  const seeds = [...SEED_PUMPED, ...SEED_CANDIDATES];
  const allowedBases = futuresBases(exchangeInfo);
  const rawTokens = [...seeds, ...alphaUniverse(alphaList, seeds, 180, allowedBases)];
  const alphaMap = chooseAlphaMap(alphaList, rawTokens);
  const futuresMap = chooseFuturesMap(exchangeInfo, rawTokens);
  const tokens = rawTokens.filter((token) => futuresMap.has(token)).slice(0, 90);

  const records = await mapLimit(tokens, 6, async (token) => {
    const alpha = alphaMap.get(token) || null;
    const info = futuresMap.get(token);
    let futures = null;
    let chart = [];
    if (info) {
      try {
        const rows = await getJson(`${FUTURES_BASE}/fapi/v1/klines?${q({ symbol: info.symbol, interval: "1h", limit: 720 })}`);
        const candles = rows.map(parseKline);
        const last = candles[candles.length - 1];
        const ret4h = change(candles[Math.max(0, candles.length - 5)].c, last.c) * 100;
        const ret24h = change(candles[Math.max(0, candles.length - 25)].c, last.c) * 100;
        const ret72h = change(candles[Math.max(0, candles.length - 73)].c, last.c) * 100;
        const ret7d = change(candles[Math.max(0, candles.length - 169)].c, last.c) * 100;
        const range7d = windowRangePct(candles, 168);
        const vol24Ratio = vol1hRatio(candles, 24);
        const pumpDump = pumpDumpMetric(candles);
        const historyHigh = Math.max(...candles.map((candle) => n(candle.h)).filter((value) => value > 0), last.c);
        const drawdownFromHigh = historyHigh > 0 ? change(historyHigh, last.c) * 100 : 0;
        let oi = { changePct: 0 };
        try {
          const oiRows = await getJson(`${FUTURES_BASE}/futures/data/openInterestHist?${q({ symbol: info.symbol, period: "1d", limit: 30 })}`);
          const values = oiRows.map((row) => n(row.sumOpenInterestValue)).filter((value) => value > 0);
          oi = { changePct: values.length > 1 ? change(values[0], values[values.length - 1]) * 100 : 0 };
        } catch {
          oi = { changePct: 0 };
        }
        futures = {
          symbol: info.symbol,
          contractType: info.contractType,
          onboardDate: n(info.onboardDate),
          price: last.c,
          ret4h,
          ret24h,
          ret72h,
          ret7d,
          range7d,
          vol1hRatio: vol1hRatio(candles, 1),
          vol24Ratio,
          oi,
          oi30d: oi,
          pumpPct: pumpDump.pumpPct,
          dumpPct: pumpDump.dumpPct,
          drawdownFromHigh,
          cohort: SEED_PUMPED.includes(token) ? "pumped" : "candidate",
        };
        chart = candles.map((candle) => ({ t: candle.t, c: candle.c, h: candle.h, l: candle.l, qv: candle.qv }));
      } catch {
        futures = null;
      }
    }
    const scored = scoreRecord(alpha, futures);
    return {
      token,
      cohort: SEED_PUMPED.includes(token) ? "pumped" : "candidate",
      score: scored.score,
      signal: scored.score >= 75,
      reasons: scored.reasons,
      alpha,
      futures,
      chart,
      updatedAt: Date.now(),
    };
  });

  const perpRecords = records.filter((record) => record && record.futures && record.futures.symbol).sort((a, b) => b.score - a.score);
  const candidates = perpRecords.filter((record) => record.cohort !== "pumped");
  return {
    generatedAt: new Date().toISOString(),
    scanMode: { scanAlphaUniverse: true, browserDirect: true },
    coverage: {
      total: perpRecords.length,
      withFutures: perpRecords.length,
      withAlpha: perpRecords.filter((record) => record.alpha).length,
    },
    seed: { pumped: SEED_PUMPED, candidates: SEED_CANDIDATES, extra: [] },
    summary: {
      total: perpRecords.length,
      signals: perpRecords.filter((record) => record.signal).length,
      candidateSignals: candidates.filter((record) => record.signal).length,
      highRisk: candidates.filter((record) => record.score >= 70).length,
      top: candidates.slice().sort((a, b) => b.score - a.score).slice(0, 10),
    },
    records: perpRecords,
  };
}

function renderStats() {
  const data = state.data;
  const perps = data.records.filter((record) => record.futures && record.futures.symbol);
  const candidates = perps.filter((record) => record.cohort !== "pumped");
  $("signals").textContent = perps.filter((record) => record.signal).length;
  $("highRisk").textContent = candidates.filter((record) => record.score >= 70).length;
  $("coverage").textContent = `${perps.length} perps`;
  $("lastScan").textContent = new Date(data.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("modePill").textContent = data.scanMode.scanAlphaUniverse ? "perp alpha universe" : "perp seed list";
}

function renderTable() {
  const visible = rows();
  if (!visible.some((item) => item.token === state.selected)) {
    state.selected = visible[0]?.token || null;
  }
  $("rowCount").textContent = `${visible.length} tokens`;
  $("rows").innerHTML = visible
    .map((item, index) => {
      const f = item.futures || {};
      const a = item.alpha || {};
      const cls = scoreClass(item.score);
      return `<tr data-token="${item.token}" class="${item.token === state.selected ? "selected" : ""} ${item.signal ? "signal-row" : ""}">
        <td><div class="token"><strong>${item.token}</strong><span>${f.symbol} - ${f.pattern || item.cohort} - ${a.alphaId || "no alpha"}</span></div></td>
        <td><div class="score-cell"><strong>${item.score}</strong><span class="track"><span class="fill ${cls}" style="width:${item.score}%"></span></span></div></td>
        <td class="${trend(f.ret4h)}">${pct(f.ret4h)}</td>
        <td class="${trend(f.ret24h)}">${pct(f.ret24h)}</td>
        <td>${x(f.vol1hRatio)}</td>
        <td class="${trend((f.oi30d || f.oi) && (f.oi30d || f.oi).changePct)}">${pct((f.oi30d || f.oi) && (f.oi30d || f.oi).changePct)}</td>
        <td class="${trend(f.pumpPct)}">${pct(f.pumpPct)}</td>
        <td class="${trend(f.dumpPct)}">${pct(f.dumpPct)}</td>
        <td>${x(a.volumeLiquidity)}</td>
        <td>${money(a.liquidity)}</td>
      </tr>`;
    })
    .join("");

  document.querySelectorAll("#rows tr").forEach((tr) => {
    tr.addEventListener("click", () => {
      state.selected = tr.dataset.token;
      renderTable();
      renderRank();
      renderDetail();
    });
  });
}

function renderRank() {
  const candidates = (state.data?.records || [])
    .filter((record) => record.cohort !== "pumped" && record.futures && record.futures.symbol)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  $("rankList").innerHTML = candidates
    .map((item) => {
      const reason = (item.reasons || []).slice(0, 2).join(" - ");
      return `<li data-token="${item.token}" class="${item.token === state.selected ? "selected" : ""}">
        <div class="rank-line">
          <strong>${item.token}</strong>
          <span class="score ${scoreClass(item.score)}">${item.score}</span>
        </div>
        <p>${item.futures.symbol}${reason ? ` - ${reason}` : ""}</p>
      </li>`;
    })
    .join("");

  document.querySelectorAll("#rankList li").forEach((li) => {
    li.addEventListener("click", () => {
      state.selected = li.dataset.token;
      renderTable();
      renderRank();
      renderDetail();
    });
  });
}

function renderDetail() {
  if (!state.data || !state.selected) return;
  const item = state.data.records.find((record) => record.token === state.selected);
  if (!item) return;
  const f = item.futures || {};
  const a = item.alpha || {};
  $("detailMeta").textContent = item.signal ? "active signal" : item.cohort;
  $("detailTitle").textContent = item.token;
  $("detailScore").textContent = item.score;
  $("detailScore").className = `score ${scoreClass(item.score)}`;
  $("perp").textContent = f.symbol || "-";
  $("price").textContent = f.price ? String(f.price) : a.price ? String(a.price) : "-";
  $("mcap").textContent = money(a.marketCap);
  $("liq").textContent = money(a.liquidity);
  $("oi30d").textContent = pct((f.oi30d || f.oi) && (f.oi30d || f.oi).changePct);
  $("maxPump").textContent = pct(f.pumpPct);
  $("maxDump").textContent = pct(f.dumpPct);
  $("pattern").textContent = f.pattern || item.cohort;
  $("chartMeta").textContent = item.chartLabel || "30d preview - loading full history";
  $("reasons").innerHTML = (item.reasons.length ? item.reasons : ["no active trigger"])
    .map((reason) => `<span class="chip">${reason}</span>`)
    .join("");
  drawChart(item.chartFull || item.chart || []);
  loadChartHistory(item);
}

async function loadChartHistory(item) {
  const symbol = item.futures && item.futures.symbol;
  if (!symbol || item.chartFull || item.chartLoading) return;
  item.chartLoading = true;
  try {
    const range = chartIntervalFor(item);
    const params = { symbol, interval: range.interval, limit: 1500 };
    if (range.startTime) params.startTime = range.startTime;
    let rows = await getJson(`${FUTURES_BASE}/fapi/v1/klines?${q(params)}`);
    if (!Array.isArray(rows) || rows.length < 2) {
      rows = await getJson(`${FUTURES_BASE}/fapi/v1/klines?${q({ symbol, interval: range.interval, limit: 1500 })}`);
    }
    const full = rows.map(parseKline).map((candle) => ({ t: candle.t, c: candle.c, h: candle.h, l: candle.l, qv: candle.qv }));
    if (full.length > 1) {
      item.chartFull = full;
      item.chartLabel = `${range.label} - ${full.length} candles`;
      const pumpDump = pumpDumpMetric(full);
      item.futures.pumpPct = pumpDump.pumpPct;
      item.futures.dumpPct = pumpDump.dumpPct;
      if (state.selected === item.token) {
        $("maxPump").textContent = pct(pumpDump.pumpPct);
        $("maxDump").textContent = pct(pumpDump.dumpPct);
        $("chartMeta").textContent = item.chartLabel;
        drawChart(full);
      }
    }
  } catch {
    item.chartFull = item.chart || [];
  } finally {
    item.chartLoading = false;
  }
}

function drawChart(points) {
  const canvas = $("chart");
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, Math.floor(rect.width * ratio));
  canvas.height = Math.max(240, Math.floor(rect.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const w = rect.width;
  const h = rect.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0f1319";
  ctx.fillRect(0, 0, w, h);

  if (!points.length) {
    ctx.fillStyle = "#848e9c";
    ctx.font = "14px Inter, sans-serif";
    ctx.fillText("No futures chart", 18, 28);
    return;
  }

  const pad = { l: 44, r: 14, t: 18, b: 38 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const prices = points.flatMap((p) => [n(p.h), n(p.l), n(p.c)]).filter(Boolean);
  const vols = points.map((p) => n(p.qv));
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const maxV = Math.max(...vols, 1);
  const xFor = (i) => pad.l + (i / Math.max(points.length - 1, 1)) * innerW;
  const yFor = (price) => pad.t + (1 - (price - minP) / Math.max(maxP - minP, 1e-12)) * innerH * 0.72;

  ctx.strokeStyle = "#2b3139";
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i += 1) {
    const y = pad.t + (innerH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(240, 185, 11, 0.18)";
  points.forEach((p, i) => {
    const barW = Math.max(1, innerW / points.length - 1);
    const barH = (n(p.qv) / maxV) * innerH * 0.22;
    ctx.fillRect(xFor(i), pad.t + innerH - barH, barW, barH);
  });

  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, "#f0b90b");
  grad.addColorStop(0.6, "#0ecb81");
  grad.addColorStop(1, "#f6465d");
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  points.forEach((p, i) => {
    const xPos = xFor(i);
    const yPos = yFor(n(p.c));
    if (i === 0) ctx.moveTo(xPos, yPos);
    else ctx.lineTo(xPos, yPos);
  });
  ctx.stroke();

  ctx.fillStyle = "#848e9c";
  ctx.font = "12px Inter, sans-serif";
  ctx.fillText(`high ${maxP.toPrecision(4)}`, 8, pad.t + 8);
  ctx.fillText(`low ${minP.toPrecision(4)}`, 8, pad.t + innerH * 0.72);
  ctx.fillText(new Date(points[0].t).toISOString().slice(0, 10), pad.l, h - 14);
  ctx.fillText(new Date(points[points.length - 1].t).toISOString().slice(0, 10), Math.max(pad.l, w - 104), h - 14);
}

function render() {
  if (!state.data) return;
  renderStats();
  renderTable();
  renderRank();
  renderDetail();
}

function bind() {
  $("refreshButton").addEventListener("click", loadLive);
  $("search").addEventListener("input", (event) => {
    state.query = event.target.value;
    renderTable();
    renderDetail();
  });
  document.querySelectorAll(".segmented button").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      document.querySelectorAll(".segmented button").forEach((b) => b.classList.remove("active"));
      button.classList.add("active");
      renderTable();
      renderDetail();
    });
  });
  window.addEventListener("resize", renderDetail);
}

bind();
loadLive();
setInterval(loadLive, 60_000);
