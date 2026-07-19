/**
 * 全面测试：速度、真伪流式、缓存、智能、并发稳定、偷工减料、上下文长度、用量真实性
 */
import { runStreamTest, runNonStreamTest } from './request.mjs'
import { runConcurrencyTest } from './concurrency.mjs'
import { runCornerCuttingTest } from './corner-cutting.mjs'
import { runContextLengthTest } from './context-length.mjs'
import { runUsageTest } from './usage-check.mjs'
import { buildScorecard } from './scorecard.mjs'

const LONG_PROMPT = '请用大约500字详细介绍人工智能的发展历史，从图灵测试讲到GPT-4，包含深度学习、大语言模型等重要阶段。'
const INTELLIGENCE_PROMPT = '有一个3升的水桶和一个5升的水桶，如何得到4升水？请一步一步解释。'
// 短请求：带当天日期的算术题，答案确定且随日期变化，避免被缓存/预生成糊弄
const SHORT_PROMPT = '今天是X月Y日，3天后是几月几日？请只回答「X月Y日」不要解释。'
function buildShortPrompt() {
  const d = new Date()
  return SHORT_PROMPT.replace('X月', (d.getMonth() + 1) + '月').replace('Y日', d.getDate() + '日')
}
function expectedShortAnswer() {
  const d = new Date()
  d.setDate(d.getDate() + 3)
  return (d.getMonth() + 1) + '月' + d.getDate() + '日'
}

export async function comprehensiveTest({ url, key, model }) {
  const headers = { 'Authorization': 'Bearer ' + key }
  const fullUrl = url.replace(/\/v1\/?$/, '').replace(/\/$/, '') + '/v1/chat/completions'

  const mkBody = (prompt, stream) => ({
    model,
    messages: [{ role: 'user', content: prompt }],
    stream,
    max_tokens: stream ? 2000 : 2000
  })

  const results = {}
  const errors = []

  // 1. 短提示基础延迟 + 简单能力核验（带日期算术题，无法被缓存）
  try {
    results.short = await runNonStreamTest({
      url: fullUrl, headers, body: mkBody(buildShortPrompt(), false), addNonce: true
    })
    const expected = expectedShortAnswer()
    const got = results.short.responseText || ''
    const m = got.match(/(\d+)\s*月\s*(\d+)\s*日/)
    results.short.expectedAnswer = expected
    results.short.answerCorrect = !!(m && parseInt(m[1], 10) === parseInt(expected.match(/(\d+)月/)[1], 10) && parseInt(m[2], 10) === parseInt(expected.match(/(\d+)日/)[1], 10))
  } catch (e) { errors.push('short:' + e.message) }

  // 2. 流式速度（长文本）
  try {
    results.stream = await runStreamTest({
      url: fullUrl, headers, body: mkBody(LONG_PROMPT, true), addNonce: true
    })
  } catch (e) { errors.push('stream:' + e.message) }

  // 3. 非流式速度（长文本）
  try {
    results.long = await runNonStreamTest({
      url: fullUrl, headers, body: mkBody(LONG_PROMPT, false), addNonce: false
    })
  } catch (e) { errors.push('long:' + e.message) }

  // 4. 智能化测试（水桶问题）
  try {
    results.intel = await runNonStreamTest({
      url: fullUrl, headers, body: mkBody(INTELLIGENCE_PROMPT, false), addNonce: false
    })
  } catch (e) { errors.push('intel:' + e.message) }

  // 5. 缓存检测（3次短提示重复）
  results.repeats = []
  for (let i = 0; i < 3; i++) {
    try {
      const r = await runNonStreamTest({
        url: fullUrl, headers,
        body: mkBody(SHORT_PROMPT, false),
        addNonce: true
      })
      results.repeats.push(r)
    } catch (e) { errors.push('repeat:' + e.message) }
  }

  // 6. 并发稳定性测试
  try {
    results.concurrency = await runConcurrencyTest({
      url: fullUrl, headers, model, concurrency: 5
    })
  } catch (e) { errors.push('concurrency:' + e.message) }

  // 7. 偷工减料检测
  try {
    results.cornerCutting = await runCornerCuttingTest({
      url: fullUrl, headers, model
    })
  } catch (e) { errors.push('cornerCutting:' + e.message) }

  // 8. 上下文长度测试
  try {
    results.contextLength = await runContextLengthTest({
      url: fullUrl, headers, model
    })
  } catch (e) { errors.push('contextLength:' + e.message) }

  // 9. Token 用量真实性
  try {
    results.usage = await runUsageTest({ url: fullUrl, headers, model })
  } catch (e) { errors.push('usage:' + e.message) }

  // === 分析 ===
  results.analysis = {
    summary: {},
    anomalies: []
  }

  // 流式分析
  if (results.stream?.stats) {
    const s = results.stream.stats
    results.analysis.streamTps = Math.round(s.tokensPerSec)
    results.analysis.streamTtfb = Math.round(results.stream.ttfb)
    results.analysis.streamTotal = Math.round(results.stream.totalTime)
    results.analysis.streamWindow = Math.round(s.totalTime)
    results.analysis.streamChunks = s.totalChunks
    results.analysis.hasThinkTags = results.stream.fullText?.includes('<think>') || false
    results.analysis.streamCharLen = results.stream.fullText?.length || 0

    // 伪流式检测
    if (s.totalTime > 0 && s.totalTime < 100) {
      results.analysis.anomalies.push('⚠ 流式窗口极短(' + s.totalTime + 'ms)，疑似伪流式')
    }
    if (s.totalChunks <= 3) {
      results.analysis.anomalies.push('⚠ 流式chunk数过少(' + s.totalChunks + ')，流式特征不明显')
    }
    if (s.firstChunkRatio > 0.8) {
      results.analysis.anomalies.push('⚠ 首个chunk占比' + (s.firstChunkRatio * 100).toFixed(0) + '%，一次性返回后分块发送')
    }
  }

  // 非流式速度分析
  if (results.long) {
    results.analysis.longTime = Math.round(results.long.totalTime)
    results.analysis.longLen = results.long.responseText?.length || 0
    results.analysis.longTps = results.long.totalTime > 0
      ? Math.round(((results.long.responseText?.length || 0) * 0.4) / (results.long.totalTime / 1000))
      : 0

    if (results.long.totalTime < 500 && results.analysis.longLen > 100) {
      results.analysis.anomalies.push('⚠ 非流式长文本耗时仅' + Math.round(results.long.totalTime) + 'ms但返回' + results.analysis.longLen + '字符，疑似缓存命中')
    }
  }

  // 智能化分析
  if (results.intel?.responseText) {
    const text = results.intel.responseText
    results.analysis.intelTime = Math.round(results.intel.totalTime)
    results.analysis.intelLen = text.length
    results.analysis.intelResult = evaluateIntelligence(text)
  }

  // 缓存检测
  if (results.repeats?.length >= 2) {
    const texts = results.repeats.map(r => r.responseText || '')
    const identical = countIdentical(texts)
    const pairs = texts.length * (texts.length - 1) / 2
    const identicalPairs = identical.totalPairs
    const identicalRate = pairs > 0 ? identicalPairs / pairs : 0
    results.analysis.repeatIdenticalRate = Math.round(identicalRate * 100)

    if (identicalRate > 0.8) {
      results.analysis.anomalies.push('⚠ 重复请求响应一致率' + Math.round(identicalRate * 100) + '%，可能是缓存/预计算')
    }

    // TTFB稳定性
    const ttfbValues = results.repeats.map(r => r.ttfb).filter(v => v > 0)
    if (ttfbValues.length >= 2) {
      const ttfbVariance = calcVariance(ttfbValues)
      if (ttfbVariance < 10) {
        results.analysis.anomalies.push('⚠ 重复请求TTFB方差仅' + ttfbVariance.toFixed(1) + '，过于稳定，疑似固定节流')
      }
      results.analysis.ttfbVariance = Math.round(ttfbVariance)
    }
  }

  // 短请求答案核验
  if (results.short) {
    results.analysis.shortTime = Math.round(results.short.totalTime)
    if (results.short.answerCorrect === false) {
      results.analysis.anomalies.push('⚠ 简单日期算术题答错（期望 ' + results.short.expectedAnswer + '），疑似模型能力弱或被降级')
    }
  }

  // 模型识别
  if (results.stream?.fullText) {
    const ft = results.stream.fullText
    if (ft.includes('<think>')) results.analysis.modelType = '推理型(有think标签)'
    else if (ft.includes('GLM') || ft.includes('glm')) results.analysis.modelType = 'GLM系列'
    else if (ft.includes('Claude') || ft.includes('claude')) results.analysis.modelType = '疑似Claude'
    else results.analysis.modelType = '未知'
  }

  // 并发稳定性
  if (results.concurrency) {
    results.analysis.concurrency = results.concurrency.stats
    results.analysis.anomalies.push(...results.concurrency.anomalies)
  }
  // 偷工减料
  if (results.cornerCutting) {
    results.analysis.cornerCutting = {
      checks: results.cornerCutting.checks,
      passed: results.cornerCutting.checks.filter(c => c.ok).length,
      total: results.cornerCutting.checks.length
    }
    results.analysis.anomalies.push(...results.cornerCutting.anomalies)
  }
  // 上下文长度
  if (results.contextLength) {
    results.analysis.contextLength = {
      tiers: results.contextLength.tiers,
      maxSupportedTier: results.contextLength.maxSupportedTier
    }
    results.analysis.anomalies.push(...results.contextLength.anomalies)
  }
  // Token 用量
  if (results.usage) {
    results.analysis.usage = {
      available: results.usage.available,
      detail: results.usage.detail || null,
      anomalies: results.usage.anomalies || []
    }
    results.analysis.anomalies.push(...(results.usage.anomalies || []))
  }

  // 综合评分
  results.analysis.scorecard = buildScorecard(results.analysis)

  results.errors = errors
  return results
}

function evaluateIntelligence(text) {
  const checks = [
    { keyword: /5[\s]?升|5[\s]?L/i, label: '提到5升桶' },
    { keyword: /3[\s]?升|3[\s]?L/i, label: '提到3升桶' },
    { keyword: /装满|加满|灌满/i, label: '有装满操作' },
    { keyword: /倒[出掉空]|倒掉|倒出|清空/i, label: '有倒空操作' },
    { keyword: /2[\s]?升|2[\s]?L/i, label: '提到2升' },
    { keyword: /倒入|转移|倒进/i, label: '有倒水转移' },
    { keyword: /[一第]步|步骤|首先|然后|最后/i, label: '有步骤说明' },
  ]
  const passed = checks.filter(c => c.keyword.test(text))
  const keywordScore = Math.round(passed.length / checks.length * 60)
  // 解出判定：提到4升 + 步骤数≥3 + 4升出现在文本后半段（作为最终结果）
  const mentions4 = /4[\s]?升|4[\s]?L/i.test(text)
  const stepCount = (text.match(/[一第][二三四五六七]?步|步骤|然后|接着|最后/g) || []).length
  const fourPosition = mentions4 ? text.search(/4[\s]?升|4[\s]?L/i) / Math.max(text.length, 1) : 0
  const solved = mentions4 && stepCount >= 3 && fourPosition > 0.3
  const solveScore = solved ? 40 : (mentions4 ? 20 : 0)
  return {
    score: keywordScore + solveScore,
    passed: passed.map(c => c.label),
    total: checks.length,
    solved,
    stepCount,
    note: solved ? '正确解出水桶问题' : (mentions4 ? '提到4升但步骤不充分或位置异常' : '未给出正确答案')
  }
}

function countIdentical(texts) {
  let totalPairs = 0, identicalPairs = 0
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      totalPairs++
      const sim = simpleSimilarity(texts[i], texts[j])
      if (sim > 0.95) identicalPairs++
    }
  }
  return { totalPairs, identicalPairs }
}

function simpleSimilarity(a, b) {
  if (!a || !b) return 0
  if (a === b) return 1
  const min = Math.min(a.length, b.length)
  if (min === 0) return 0
  const max = Math.max(a.length, b.length)
  let same = 0
  for (let i = 0; i < min; i++) {
    if (a[i] === b[i]) same++
  }
  return same / max
}

function calcVariance(arr) {
  if (arr.length < 2) return 0
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length
  return arr.reduce((s, x) => s + (x - mean) ** 2, 0) / arr.length
}
