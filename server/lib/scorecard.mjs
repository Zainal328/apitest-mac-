/**
 * 综合评分与人话评级
 * 把全部测试指标映射成 0-100 分、一句话结论、每项指标的人话评级。
 * 评级逻辑：分数 + 阈值 → {level: 'good'|'warn'|'bad', label: '人话'}
 */

// 每项指标的评级：返回 {score贡献, level, label}
export function buildScorecard(analysis = {}) {
  const dims = []

  // —— 1. 速度（流式 TTFB） ——
  const ttfb = analysis.streamTtfb
  dims.push({
    key: 'speed',
    name: '响应速度',
    icon: '⚡',
    raw: ttfb,
    rawLabel: ttfb != null ? ttfb + ' ms' : '未测',
    ...judgeLower(ttfb, [120, 300, 800], ['飞快', '正常', '偏慢', '极慢'])
  })

  // —— 2. 流式吞吐 ——
  const tps = analysis.streamTps
  dims.push({
    key: 'throughput',
    name: '流式吞吐',
    icon: '🌊',
    raw: tps,
    rawLabel: tps != null ? tps + ' tok/s' : '未测',
    ...judgeHigher(tps, [10, 30, 60], ['极慢', '偏慢', '正常', '飞快'])
  })

  // —— 3. 流式真实性 ——
  const realStream = judgeRealStream(analysis)
  dims.push({
    key: 'realstream',
    name: '流式真实性',
    icon: '📡',
    raw: realStream.summary,
    rawLabel: realStream.label,
    score: realStream.score,
    level: realStream.level,
    label: realStream.label
  })

  // —— 4. 缓存嫌疑 ——
  const cache = analysis.repeatIdenticalRate
  dims.push({
    key: 'cache',
    name: '缓存嫌疑',
    icon: '🔒',
    raw: cache,
    rawLabel: cache != null ? cache + '%' : '未测',
    ...judgeLower(cache, [10, 40, 80], ['无缓存', '轻微', '有缓存', '严重缓存'])
  })

  // —— 5. 智能化 ——
  const intel = analysis.intelResult?.score ?? analysis.intelScore
  dims.push({
    key: 'intel',
    name: '智能能力',
    icon: '🧠',
    raw: intel,
    rawLabel: intel != null ? intel + '/100' : '未测',
    ...judgeHigher(intel, [40, 70, 90], ['能力弱', '一般', '良好', '优秀'])
  })

  // —— 6. 并发稳定性 ——
  const cc = analysis.concurrency
  if (cc) {
    dims.push({
      key: 'concurrency',
      name: '并发稳定',
      icon: '🔁',
      raw: cc.successRate,
      rawLabel: Math.round(cc.successRate * 100) + '% 成功',
      ...judgeHigher(cc.successRate, [0.5, 0.8, 1], ['严重限流', '偶发失败', '基本稳定', '完全稳定'])
    })
  }

  // —— 7. 偷工减料 ——
  const cc2 = analysis.cornerCutting
  if (cc2) {
    const okCount = cc2.checks.filter(c => c.ok).length
    const total = cc2.checks.length
    dims.push({
      key: 'cornercutting',
      name: '是否偷工',
      icon: '🔍',
      raw: `${okCount}/${total}`,
      rawLabel: `${okCount}/${total} 通过`,
      ...judgeHigher(okCount / total, [0.34, 0.67, 1], ['明显偷工', '可疑', '基本正常', '未偷工'])
    })
  }

  // —— 8. 上下文长度 ——
  const ctx = analysis.contextLength
  if (ctx) {
    const order = ['约2K', '约8K', '约32K']
    const max = ctx.maxSupportedTier ? order.indexOf(ctx.maxSupportedTier) : -1
    dims.push({
      key: 'context',
      name: '上下文长度',
      icon: '📏',
      raw: ctx.maxSupportedTier || '不支持',
      rawLabel: ctx.maxSupportedTier || '不支持',
      ...judgeHigher(max, [0, 1, 2], ['仅短文本', '中等', '较长', '长上下文'])
    })
  }

  // —— 9. Token 用量 ——
  const usage = analysis.usage
  if (usage) {
    dims.push({
      key: 'usage',
      name: '用量透明',
      icon: '🎫',
      raw: usage.available ? '有' : '无',
      rawLabel: usage.available ? '返回了 usage' : '无 usage 字段',
      ...judgeFlag(usage.available && !usage.anomalies?.length,
        ['用量可信', usage.available ? '用量可疑' : '无用量字段'])
    })
  }

  // —— 汇总 ——
  const scored = dims.filter(d => typeof d.score === 'number')
  const total = scored.length
    ? Math.round(scored.reduce((s, d) => s + d.score, 0) / scored.length)
    : 0

  return {
    total,
    grade: gradeOf(total),
    verdict: buildVerdict(total, dims),
    dims
  }
}

// lower-is-better：v 越小越好。breaks = [b1,b2,b3] 升序（小、中、大）
// v<=b1 → good(100), b1<v<=b2 → ok(80), b2<v<=b3 → warn(55), v>b3 → bad(20)
function judgeLower(v, breaks, labels) {
  if (v == null) return noData()
  let score, level, label
  if (v <= breaks[0]) { score = 100; level = 'good'; label = labels[0] }
  else if (v <= breaks[1]) { score = 80; level = 'good'; label = labels[1] }
  else if (v <= breaks[2]) { score = 55; level = 'warn'; label = labels[2] }
  else { score = 20; level = 'bad'; label = labels[3] }
  return { score, level, label }
}

// higher-is-better：v 越大越好。breaks 升序
function judgeHigher(v, breaks, labels) {
  if (v == null) return noData()
  let score, level, label
  if (v <= breaks[0]) { score = 20; level = 'bad'; label = labels[0] }
  else if (v <= breaks[1]) { score = 55; level = 'warn'; label = labels[1] }
  else if (v <= breaks[2]) { score = 80; level = 'good'; label = labels[2] }
  else { score = 100; level = 'good'; label = labels[3] }
  return { score, level, label }
}

function judgeFlag(ok, labels) {
  return ok
    ? { score: 100, level: 'good', label: labels[0] }
    : { score: 30, level: 'warn', label: labels[1] }
}

function noData() { return { score: undefined, level: 'none', label: '未测' } }

// 流式真实性：综合 chunk 数、窗口、首 chunk 占比、think 标签
function judgeRealStream(a) {
  const chunks = a.streamChunks
  const window = a.streamWindow
  const hasThink = a.hasThinkTags
  // 看是否有伪流式异常
  const fakeAnomaly = (a.anomalies || []).some(x => /伪流式|一次性|chunk数过少/.test(x))
  if (chunks == null) return { score: undefined, level: 'none', label: '未测', summary: null }
  if (fakeAnomaly) return { score: 25, level: 'bad', label: '疑似伪流式', summary: '伪流式' }
  if (chunks >= 8 && window > 100) {
    if (hasThink) return { score: 85, level: 'good', label: '真实流式（含推理）', summary: '真实+think' }
    return { score: 95, level: 'good', label: '真实逐 token 流式', summary: '真实流式' }
  }
  if (chunks >= 3) return { score: 65, level: 'warn', label: '流式特征偏弱', summary: '偏弱' }
  return { score: 35, level: 'bad', label: '流式特征不足', summary: '不足' }
}

function gradeOf(score) {
  if (score >= 85) return { level: 'good', tag: '推荐', color: 'good' }
  if (score >= 65) return { level: 'warn', tag: '可用', color: 'warn' }
  if (score >= 40) return { level: 'warn', tag: '谨慎', color: 'warn' }
  return { level: 'bad', tag: '不推荐', color: 'bad' }
}

function buildVerdict(total, dims) {
  const bad = dims.filter(d => d.level === 'bad')
  const warn = dims.filter(d => d.level === 'warn')
  const good = dims.filter(d => d.level === 'good')
  const parts = []
  if (total >= 85) {
    parts.push('这家中转整体表现优秀，')
  } else if (total >= 65) {
    parts.push('这家中转基本可用，')
  } else if (total >= 40) {
    parts.push('这家中转存在明显短板，')
  } else {
    parts.push('这家中转问题较多，不建议使用，')
  }
  if (bad.length) parts.push(`主要问题：${bad.map(d => d.name).join('、')}。`)
  if (warn.length && !bad.length) parts.push(`需留意：${warn.map(d => d.name).join('、')}。`)
  if (good.length && !bad.length) parts.push(`亮点：${good.map(d => d.name).join('、')}。`)
  return parts.join('')
}
