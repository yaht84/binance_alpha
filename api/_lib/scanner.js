const { getConfig } = require("./config");
const { buildUniverse, fetchTokenMarket } = require("./binance");
const { analyzeToken, summarize } = require("./signals");

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  async function lane() {
    for (;;) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      results[current] = await worker(items[current], current);
    }
  }
  const lanes = Array.from({ length: Math.min(limit, items.length) }, () => lane());
  await Promise.all(lanes);
  return results;
}

async function runScan(options = {}) {
  const config = { ...getConfig(), ...options };
  const universe = await buildUniverse(config);
  const tokenSet = new Set(universe.tokens);
  const rows = universe.tokens.map((token) => ({
    token,
    cohort: config.pumpedTokens.includes(token) ? "pumped" : "candidate",
    alpha: universe.alphaMap.get(token) || null,
    futuresInfo: universe.futuresMap.get(token) || null,
    threshold: config.alertScoreThreshold,
  }));

  const markets = await mapLimit(rows, 8, async (row) => {
    const market = await fetchTokenMarket(row.token, row.futuresInfo);
    return {
      token: row.token,
      cohort: row.cohort,
      alpha: row.alpha,
      futures: market.futures,
      threshold: row.threshold,
    };
  });

  const records = markets.map(analyzeToken).sort((a, b) => b.score - a.score);
  return {
    generatedAt: new Date(universe.serverTime || Date.now()).toISOString(),
    scanMode: {
      scanAlphaUniverse: config.scanAlphaUniverse,
      maxScanTokens: config.maxScanTokens,
      alertScoreThreshold: config.alertScoreThreshold,
    },
    coverage: {
      total: tokenSet.size,
      withFutures: rows.filter((row) => row.futuresInfo).length,
      withAlpha: rows.filter((row) => row.alpha).length,
    },
    seed: {
      pumped: config.pumpedTokens,
      candidates: config.seedCandidates,
      extra: config.extraTokens,
    },
    summary: summarize(records),
    records,
  };
}

module.exports = {
  runScan,
};
