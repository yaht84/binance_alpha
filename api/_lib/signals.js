const { n } = require("./binance");

function pct(value) {
  return Math.round(value * 10000) / 100;
}

function change(a, b) {
  if (!a || a <= 0) return 0;
  return b / a - 1;
}

function median(values) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function firstClose(candles, periodsBack) {
  if (!candles.length) return 0;
  const idx = Math.max(0, candles.length - 1 - periodsBack);
  return n(candles[idx].c);
}

function volumeWindowRatio(candles) {
  if (candles.length < 24) return 0;
  const latest = candles.slice(-4).reduce((sum, candle) => sum + n(candle.qv), 0);
  const windows = [];
  for (let end = 4; end <= candles.length - 4; end += 4) {
    const window = candles.slice(end - 4, end).reduce((sum, candle) => sum + n(candle.qv), 0);
    if (window > 0) windows.push(window);
  }
  return median(windows) > 0 ? latest / median(windows) : 0;
}

function metricChange(rows, field) {
  const values = rows.map((row) => n(row[field])).filter((value) => value > 0);
  if (values.length < 2) return { last: 0, changePct: 0, pctl: 0 };
  const last = values[values.length - 1];
  const first = values[0];
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    last,
    changePct: pct(change(first, last)),
    pctl: max > min ? ((last - min) / (max - min)) * 100 : 0,
  };
}

function ratioMetric(rows, field) {
  const values = rows.map((row) => n(row[field])).filter((value) => value > 0);
  if (!values.length) return { last: 0, p95: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  return { last: values[values.length - 1], p95 };
}

function fundingMetric(rows) {
  const values = rows.map((row) => n(row.fundingRate));
  if (!values.length) return { lastPct: 0, avgPct: 0 };
  return {
    lastPct: pct(values[values.length - 1]),
    avgPct: pct(values.reduce((sum, value) => sum + value, 0) / values.length),
  };
}

function chartPoints(candles) {
  return candles.map((candle) => ({
    t: candle.t,
    c: candle.c,
    h: candle.h,
    l: candle.l,
    qv: candle.qv,
  }));
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
    if (lowBefore > 0 && high > 0) pumpPct = Math.max(pumpPct, pct(change(lowBefore, high)));
    if (highBefore > 0 && low > 0) dumpPct = Math.min(dumpPct, pct(change(highBefore, low)));
    if (low > 0) lowBefore = Math.min(lowBefore, low);
    if (high > 0) highBefore = Math.max(highBefore, high);
  });
  return { pumpPct, dumpPct };
}

function scoreAlpha(alpha, reasons) {
  let score = 0;
  if (!alpha) return score;
  if (alpha.volumeLiquidity !== null && alpha.volumeLiquidity >= 1) {
    score += 12;
    reasons.push("alpha volume/liquidity above 1x");
  }
  if (alpha.volumeLiquidity !== null && alpha.volumeLiquidity >= 3) {
    score += 14;
    reasons.push("alpha volume/liquidity above 3x");
  }
  if (alpha.liquidity > 0 && alpha.liquidity < 1_000_000) {
    score += 10;
    reasons.push("thin alpha liquidity");
  }
  if (alpha.marketCap > 0 && alpha.marketCap < 80_000_000) {
    score += 9;
    reasons.push("low market cap");
  }
  if (alpha.fdvMcap !== null && alpha.fdvMcap >= 3) {
    score += 6;
    reasons.push("high FDV/MCAP");
  }
  if (alpha.holders !== null && alpha.holders < 30_000) {
    score += 5;
    reasons.push("small holder base");
  }
  if (Math.abs(alpha.change24h) >= 12) {
    score += 6;
    reasons.push("large alpha 24h move");
  }
  if (alpha.hotTag) {
    score += 5;
    reasons.push("alpha hot tag");
  }
  return score;
}

function analyzeToken(record) {
  const reasons = [];
  const futures = record.futures;
  const alpha = record.alpha || null;
  let score = scoreAlpha(alpha, reasons);
  const now = Date.now();

  const live = {
    token: record.token,
    cohort: record.cohort,
    score: 0,
    reasons: [],
    alpha,
    futures: null,
    chart: [],
    updatedAt: now,
    signal: false,
  };

  if (futures && futures.k15 && futures.k15.length) {
    const k15 = futures.k15;
    const k1h = futures.k1h || [];
    const last = k15[k15.length - 1];
    const high24 = Math.max(...k15.map((candle) => n(candle.h)));
    const low24 = Math.min(...k15.map((candle) => n(candle.l)).filter((value) => value > 0));
    const qv24 = k15.reduce((sum, candle) => sum + n(candle.qv), 0);
    const takerBuy24 = k15.reduce((sum, candle) => sum + n(candle.takerBuyQv), 0);
    const ret1h = pct(change(firstClose(k15, 4), last.c));
    const ret4h = pct(change(firstClose(k15, 16), last.c));
    const ret24h = pct(change(firstClose(k15, 95), last.c));
    const ret72h = k1h.length ? pct(change(firstClose(k1h, 72), k1h[k1h.length - 1].c)) : 0;
    const range24 = pct(change(low24, high24));
    const vol1hRatio = volumeWindowRatio(k15);
    const nearHigh = high24 > 0 ? pct(last.c / high24 - 1) : 0;
    const oi = metricChange(futures.oi || [], "sumOpenInterestValue");
    const oi30d = metricChange(futures.oi30d || futures.oi || [], "sumOpenInterestValue");
    const topPos = ratioMetric(futures.topPos || [], "longShortRatio");
    const takerRatio = ratioMetric(futures.taker || [], "buySellRatio");
    const funding = fundingMetric(futures.funding || []);
    const takerBuyShare = qv24 > 0 ? (takerBuy24 / qv24) * 100 : 0;
    const historyCandles = k1h.length ? k1h : k15;
    const pumpDump = pumpDumpMetric(historyCandles);

    if (vol1hRatio >= 2.2) {
      score += 13;
      reasons.push("1h futures volume breakout");
    }
    if (ret4h >= 8 && ret4h <= 55) {
      score += 9;
      reasons.push("early 4h momentum");
    }
    if (ret24h >= 15 && ret24h <= 95) {
      score += 9;
      reasons.push("24h momentum before vertical stage");
    }
    if (nearHigh > -6 && range24 >= 18) {
      score += 8;
      reasons.push("price pressing 24h high");
    }
    if (oi.changePct >= 35) {
      score += 12;
      reasons.push("open interest expanding fast");
    }
    if (topPos.last >= 2) {
      score += 6;
      reasons.push("top traders crowded long");
    }
    if (takerRatio.last >= 1.25) {
      score += 6;
      reasons.push("aggressive taker buy flow");
    }
    if (takerBuyShare >= 56) {
      score += 5;
      reasons.push("taker buy share above 56%");
    }
    if (funding.lastPct > 0.08) {
      score += 4;
      reasons.push("funding turning hot");
    }

    live.futures = {
      symbol: futures.symbol,
      contractType: futures.contractType,
      onboardDate: futures.onboardDate,
      price: last.c,
      ret1h,
      ret4h,
      ret24h,
      ret72h,
      range24,
      qv24,
      vol1hRatio,
      nearHigh,
      oi,
      oi30d,
      pumpPct: pumpDump.pumpPct,
      dumpPct: pumpDump.dumpPct,
      topPos,
      takerRatio,
      funding,
      takerBuyShare,
    };
    live.chart = chartPoints(historyCandles);
  }

  live.score = Math.min(100, Math.round(score));
  live.reasons = [...new Set(reasons)].slice(0, 8);
  live.signal = live.score >= record.threshold;
  live.signalKey = `${live.token}:${Math.floor(now / (60 * 60 * 1000))}:${live.reasons.slice(0, 3).join("|")}`;
  return live;
}

function summarize(results) {
  const candidates = results.filter((item) => item.cohort !== "pumped");
  return {
    total: results.length,
    signals: results.filter((item) => item.signal).length,
    candidateSignals: candidates.filter((item) => item.signal).length,
    highRisk: candidates.filter((item) => item.score >= 70).length,
    top: [...candidates].sort((a, b) => b.score - a.score).slice(0, 10),
  };
}

module.exports = {
  analyzeToken,
  summarize,
};
