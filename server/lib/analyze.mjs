/**
 * 统计与反作弊分析
 */

export function analyzeTestRuns(runs) {
  if (!runs || runs.length === 0) {
    return {
      summary: null,
      anomalies: [],
      similarity: null
    }
  }

  const successful = runs.filter(r => r && r.status >= 200 && r.status < 300)
  const ttfbValues = successful.map(r => r.ttfb).filter(Number.isFinite)
  const totalValues = successful.map(r => r.totalTime).filter(Number.isFinite)
  const tpsValues = successful.map(r => r.stats?.tokensPerSec).filter(Number.isFinite)
  const chunkCounts = successful.map(r => r.stats?.totalChunks).filter(Number.isFinite)
  const firstChunkRatios = successful.map(r => r.stats?.firstChunkRatio).filter(Number.isFinite)

  const summary = {
    count: runs.length,
    successCount: successful.length,
    ttfb: summarize(ttfbValues),
    totalTime: summarize(totalValues),
    tokensPerSec: summarize(tpsValues),
    chunkCount: summarize(chunkCounts),
    firstChunkRatio: summarize(firstChunkRatios)
  }

  const anomalies = []

  if (successful.length >= 2) {
    const ttfbVariance = variance(ttfbValues)
    const tpsVariance = variance(tpsValues)
    if (ttfbVariance < 2 && tpsVariance < 1) {
      anomalies.push('TTFB 与 token/s 方差极低，结果过于稳定，疑似缓存或固定节流')
    }

    if (mean(firstChunkRatios) > 0.8) {
      anomalies.push('首个 chunk 占比过高，疑似一次性返回后伪装成流式')
    }

    if (mean(chunkCounts) <= 2) {
      anomalies.push('chunk 数过少，流式特征不明显')
    }
  }

  return {
    summary,
    anomalies,
    similarity: compareResponses(runs)
  }
}

export function compareResponses(runs) {
  const texts = runs
    .map(r => r?.fullText || r?.responseText || '')
    .filter(Boolean)

  if (texts.length < 2) {
    return null
  }

  let totalPairs = 0
  let identicalPairs = 0
  let maxSimilarity = 0

  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      totalPairs++
      const sim = similarity(texts[i], texts[j])
      if (sim === 1) identicalPairs++
      if (sim > maxSimilarity) maxSimilarity = sim
    }
  }

  return {
    identicalRate: totalPairs > 0 ? identicalPairs / totalPairs : 0,
    maxSimilarity
  }
}

function summarize(values) {
  if (!values || values.length === 0) return null
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: mean(values),
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    variance: variance(values)
  }
}

function mean(arr) {
  if (!arr || arr.length === 0) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function variance(arr) {
  if (!arr || arr.length === 0) return 0
  const m = mean(arr)
  return arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length
}

function percentile(arr, p) {
  if (!arr || arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

function similarity(a, b) {
  if (a === b) return 1
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  let same = 0
  const minLen = Math.min(a.length, b.length)
  for (let i = 0; i < minLen; i++) {
    if (a[i] === b[i]) same++
  }
  return same / maxLen
}
