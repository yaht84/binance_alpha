const localMemory = new Map();

function redisReady() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

async function redisCommand(command) {
  const response = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/pipeline`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify([command]),
  });
  if (!response.ok) throw new Error(`Redis ${response.status}`);
  const payload = await response.json();
  return payload[0] && payload[0].result;
}

async function seen(key) {
  if (redisReady()) {
    const value = await redisCommand(["GET", key]);
    return Boolean(value);
  }
  const expiresAt = localMemory.get(key) || 0;
  if (expiresAt < Date.now()) {
    localMemory.delete(key);
    return false;
  }
  return true;
}

async function markSeen(key, ttlSeconds) {
  if (redisReady()) {
    await redisCommand(["SET", key, "1", "EX", ttlSeconds]);
    return;
  }
  localMemory.set(key, Date.now() + ttlSeconds * 1000);
}

module.exports = {
  seen,
  markSeen,
};
