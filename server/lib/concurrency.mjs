/**
 * 并发与稳定性测试
 * 用同一个短请求并发发起多次，观察成功率、延迟抖动、是否限流。
 * 中转常见问题：并发数上去就报错/排队、单次延迟忽高忽低。
 */
import { runNonStreamTest } from './request.mjs'

const STABILITY_PROMPT = '请用一句话回答：天空为什么是蓝色的？'

export async function runConcurrencyTest({ url, headers, concurrency = 5 }) {
  const body = {
    model: undefined,
    messages: [{ role: 'user', content: STABILITY_PROMPT }],
    stream: false,
    max_tokens: 100
  }
  // model 由调用方在 headers 之外传入，这里补上
  const mk = () => JSON.parse(JSON.stringify(body))

  const tasks = []
  for (let i = 0; i < concurrency; i++) {
    tasks.push(
      runNonStreamTest({ url, headers, body: mk(), addNonce: true })
        .then(r => ({ ok: true, r }))
        .catch(e => ({ ok: false, err: e.message }))
    )
  }
  const t0 = performance.now()
  const results = await Promise.all(tasks)
  const totalWall = performance.now() - t0

  const oks = results.filter(r => r.ok && r.r.status >= 200 && r.r.status < 300)
  const fails = results.filter(r => !r.ok || r.r.status < 200 || r.r.status >= 300)

  const ttls = oks.map(r => r.r.totalTime)
  const ttfbs = oks.map(r => r.r.ttfb)

  const stats = {
    concurrency,
    totalRequests: tasks.length,
    successCount: oks.length,
    failCount: fails.length,
    successRate: tasks.length ? oks.length / tasks.length : 0,
    wallTime: Math.round(totalWall),
    errors: fails.map(f => f.err || (f.r && f.r.status) || 'unknown')
  }

  if (ttls.length >= 2) {
    stats.ttlMin = Math.round(Math.min(...ttls))
    stats.ttlMax = Math.round(Math.max(...ttls))
    stats.ttlAvg = Math.round(mean(ttls))
    stats.ttlJitter = Math.round(stats.ttlMax - stats.ttlMin) // 抖动幅度
    stats.ttfbAvg = Math.round(mean(ttfbs))
    stats.ttlVariance = Math.round(variance(ttls))
  }

  const anomalies = []
  if (stats.failCount > 0) {
    anomalies.push(`⚠ 并发 ${concurrency} 次中失败 ${stats.failCount} 次，疑似限流/不稳定`)
  }
  if (stats.ttlJitter != null && stats.ttlJitter > 1500) {
    anomalies.push(`⚠ 并发延迟抖动 ${stats.ttlJitter}ms（最快 ${stats.ttlMin}ms / 最慢 ${stats.ttlMax}ms），延迟不稳定`)
  }
  // 并发墙时间远大于单次平均 → 说明请求是排队而非真并发
  if (stats.ttlAvg != null && totalWall > stats.ttlAvg * 1.8 && oks.length > 1) {
    anomalies.push(`⚠ 并发墙时间 ${Math.round(totalWall)}ms 远大于平均单次 ${stats.ttlAvg}ms，疑似请求被排队处理（未真正并发）`)
  }

  return { stats, anomalies, raw: results.map(r => r.ok ? {
    status: r.r.status, ttfb: Math.round(r.r.ttfb), total: Math.round(r.r.totalTime)
  } : { error: r.err }) }
}

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length }
function variance(arr) {
  const m = mean(arr)
  return arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length
}
