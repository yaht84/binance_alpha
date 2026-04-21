const { buildUniverse } = require("./_lib/binance");
const { getConfig } = require("./_lib/config");

module.exports = async function handler(req, res) {
  try {
    const config = {
      ...getConfig(),
      scanAlphaUniverse: false,
      maxScanTokens: 3,
    };
    const universe = await buildUniverse(config);
    res.status(200).json({
      ok: true,
      generatedAt: new Date(universe.serverTime || Date.now()).toISOString(),
      regionHint: process.env.VERCEL_REGION || null,
      futuresEnabled: !config.disableFutures,
      withFutures: universe.futuresMap.size,
      withAlpha: universe.alphaMap.size,
      tokens: universe.tokens,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message,
      regionHint: process.env.VERCEL_REGION || null,
    });
  }
};
