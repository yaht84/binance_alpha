const FUTURES_BASE = "https://fapi.binance.com";
const BINANCE_BASE = "https://www.binance.com";

const memory = {
  exchange: null,
  exchangeAt: 0,
  alpha: null,
  alphaAt: 0,
};

function now() {
  return Date.now();
}

function n(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withQuery(url, params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") search.set(key, value);
  });
  const query = search.toString();
  return query ? `${url}?${query}` : url;
}

async function fetchJson(url, params, options = {}) {
  const finalUrl = withQuery(url, params);
  const tries = options.tries || 3;
  let lastError;
  for (let i = 0; i < tries; i += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || 14000);
    try {
      const response = await fetch(finalUrl, {
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "user-agent": "binance-alpha-pnd-live-radar/0.1",
        },
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      await sleep(250 + i * 350);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`GET failed ${finalUrl}: ${lastError.message}`);
}

async function getExchangeInfo() {
  if (memory.exchange && now() - memory.exchangeAt < 15 * 60 * 1000) return memory.exchange;
  memory.exchange = await fetchJson(`${FUTURES_BASE}/fapi/v1/exchangeInfo`);
  memory.exchangeAt = now();
  return memory.exchange;
}

async function getAlphaList() {
  if (memory.alpha && now() - memory.alphaAt < 10 * 60 * 1000) return memory.alpha;
  const payload = await fetchJson(`${BINANCE_BASE}/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list`);
  memory.alpha = payload.data || [];
  memory.alphaAt = now();
  return memory.alpha;
}

function alphaSnapshot(item) {
  if (!item) return null;
  const marketCap = n(item.marketCap);
  const fdv = n(item.fdv);
  const liquidity = n(item.liquidity);
  const volume24h = n(item.volume24h);
  const holders = n(item.holders);
  const circ = n(item.circulatingSupply);
  const supply = n(item.totalSupply);
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
    circulatingPct: supply > 0 ? (circ / supply) * 100 : null,
    count24h: item.count24h === null || item.count24h === undefined ? null : n(item.count24h),
    score: n(item.score),
    listingCex: Boolean(item.listingCex),
    cexCoinName: item.cexCoinName || "",
    offline: Boolean(item.offline),
    fullyDelisted: Boolean(item.fullyDelisted),
    hotTag: Boolean(item.hotTag),
    stockState: Boolean(item.stockState),
    listingTime: n(item.listingTime),
  };
}

function alphaPreScore(snap) {
  if (!snap || snap.fullyDelisted || snap.offline || snap.stockState) return -1;
  let score = 0;
  if (snap.volumeLiquidity !== null && snap.volumeLiquidity >= 1) score += 25;
  if (snap.volumeLiquidity !== null && snap.volumeLiquidity >= 3) score += 20;
  if (snap.liquidity > 0 && snap.liquidity < 1_000_000) score += 18;
  if (snap.marketCap > 0 && snap.marketCap < 80_000_000) score += 14;
  if (snap.fdvMcap !== null && snap.fdvMcap > 3) score += 8;
  if (snap.holders !== null && snap.holders < 30_000) score += 8;
  if (Math.abs(snap.change24h) > 12) score += 7;
  if (snap.hotTag) score += 8;
  if (snap.count24h !== null && snap.count24h < 400) score += 4;
  return score;
}

function chooseAlphaMap(alphaList, tokenSet) {
  const bySymbol = new Map();
  alphaList.forEach((item) => {
    const snap = alphaSnapshot(item);
    if (!snap || !snap.symbol) return;
    const keys = [snap.symbol, String(item.cexCoinName || "").toUpperCase()].filter(Boolean);
    keys.forEach((key) => {
      if (!bySymbol.has(key)) bySymbol.set(key, []);
      bySymbol.get(key).push({ raw: item, snap, preScore: alphaPreScore(snap) });
    });
  });

  const out = new Map();
  tokenSet.forEach((token) => {
    const matches = bySymbol.get(token) || [];
    matches.sort((a, b) => b.preScore - a.preScore || b.snap.volume24h - a.snap.volume24h);
    if (matches[0]) out.set(token, matches[0].snap);
  });
  return out;
}

function chooseFuturesMap(exchangeInfo, tokenSet) {
  const byBase = new Map();
  (exchangeInfo.symbols || []).forEach((item) => {
    if (item.quoteAsset !== "USDT") return;
    if (!["PERPETUAL", "TRADIFI_PERPETUAL"].includes(item.contractType)) return;
    const base = String(item.baseAsset || "").toUpperCase();
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(item);
  });
  const out = new Map();
  tokenSet.forEach((token) => {
    const matches = byBase.get(token) || [];
    matches.sort((a, b) => {
      const ap = a.contractType === "PERPETUAL" ? 1 : 0;
      const bp = b.contractType === "PERPETUAL" ? 1 : 0;
      return bp - ap;
    });
    if (matches[0]) out.set(token, matches[0]);
  });
  return out;
}

function alphaUniverse(alphaList, seedTokens, maxTokens, allowedBases = null) {
  const rows = [];
  const seen = new Set(seedTokens);
  alphaList.forEach((item) => {
    const snap = alphaSnapshot(item);
    if (!snap || !snap.symbol) return;
    if (!/^[A-Z0-9]{1,15}$/.test(snap.symbol)) return;
    if (allowedBases && !allowedBases.has(snap.symbol)) return;
    if (seen.has(snap.symbol)) return;
    const score = alphaPreScore(snap);
    if (score < 25) return;
    rows.push({ symbol: snap.symbol, score, snap });
  });
  rows.sort((a, b) => b.score - a.score || b.snap.volume24h - a.snap.volume24h);
  return rows.slice(0, Math.max(0, maxTokens - seedTokens.size)).map((row) => row.symbol);
}

async function futuresKlines(symbol, interval, limit) {
  const rows = await fetchJson(`${FUTURES_BASE}/fapi/v1/klines`, { symbol, interval, limit });
  return rows.map((row) => ({
    t: n(row[0]),
    o: n(row[1]),
    h: n(row[2]),
    l: n(row[3]),
    c: n(row[4]),
    v: n(row[5]),
    qv: n(row[7]),
    trades: n(row[8]),
    takerBuyQv: n(row[10]),
  }));
}

async function futuresData(symbol, endpoint, period = "15m", limit = 96) {
  try {
    const rows = await fetchJson(`${FUTURES_BASE}/futures/data/${endpoint}`, { symbol, period, limit });
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    return [];
  }
}

async function funding(symbol, limit = 24) {
  try {
    const rows = await fetchJson(`${FUTURES_BASE}/fapi/v1/fundingRate`, { symbol, limit });
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    return [];
  }
}

async function buildUniverse(config) {
  const alphaList = await getAlphaList();
  let exchange = null;
  let allowedBases = null;
  if (!config.disableFutures) {
    try {
      exchange = await getExchangeInfo();
      allowedBases = new Set(
        (exchange.symbols || [])
          .filter((item) => item.quoteAsset === "USDT" && ["PERPETUAL", "TRADIFI_PERPETUAL"].includes(item.contractType))
          .map((item) => String(item.baseAsset || "").toUpperCase())
          .filter(Boolean),
      );
    } catch (error) {
      console.warn(`Futures exchangeInfo unavailable: ${error.message}`);
    }
  }
  const seed = new Set([...config.pumpedTokens, ...config.seedCandidates, ...config.extraTokens].map((x) => x.toUpperCase()));
  if (config.scanAlphaUniverse) {
    alphaUniverse(alphaList, seed, config.maxScanTokens * 2, allowedBases).forEach((token) => seed.add(token));
  }
  const alphaMap = chooseAlphaMap(alphaList, seed);
  const futuresMap = exchange ? chooseFuturesMap(exchange, seed) : new Map();
  const tokens = Array.from(seed)
    .filter((token) => futuresMap.has(token))
    .slice(0, config.maxScanTokens);
  return {
    tokens,
    alphaMap,
    futuresMap,
    serverTime: n(exchange && exchange.serverTime, Date.now()),
  };
}

async function fetchTokenMarket(token, futuresInfo) {
  if (!futuresInfo) return { token, futures: null };
  const symbol = futuresInfo.symbol;
  const [k15, k1h, oi, topPos, taker, fundingRows] = await Promise.all([
    futuresKlines(symbol, "15m", 96).catch(() => []),
    futuresKlines(symbol, "1h", 720).catch(() => []),
    futuresData(symbol, "openInterestHist", "15m", 96),
    futuresData(symbol, "topLongShortPositionRatio", "15m", 96),
    futuresData(symbol, "takerlongshortRatio", "15m", 96),
    funding(symbol, 24),
  ]);
  return {
    token,
    futures: {
      symbol,
      contractType: futuresInfo.contractType,
      underlyingSubType: futuresInfo.underlyingSubType || [],
      marketTakeBound: n(futuresInfo.marketTakeBound),
      onboardDate: n(futuresInfo.onboardDate),
      k15,
      k1h,
      oi,
      topPos,
      taker,
      funding: fundingRows,
    },
  };
}

module.exports = {
  buildUniverse,
  fetchTokenMarket,
  n,
};
