/**
 * Token 用量真实性检测
 * 中转常伪造或缺失 usage 字段。这里检查：
 *  1. 是否返回 usage 字段
 *  2. prompt_tokens 是否合理（不可能是 0 或异常小）
 *  3. total_tokens 与按字符估算是否在同一数量级
 *  4. 多次同输入的 prompt_tokens 是否稳定（不稳定=伪造）
 */
import { runNonStreamTest } from './request.mjs'

const KNOWN_PROMPT = '请用中文写一篇约300字的关于春天的短文。'

export async function runUsageTest({ url, headers, model }) {
  const body = {
    model,
    messages: [{ role: 'user', content: KNOWN_PROMPT }],
    stream: false,
    max_tokens: 800
  }

  const samples = []
  for (let i = 0; i < 2; i++) {
    try {
      const res = await runNonStreamTest({ url, headers, body, addNonce: false })
      samples.push({ status: res.status, raw: res.responseText, time: res.totalTime })
    } catch (e) {
      return { available: false, error: e.message, anomalies: ['⚠ 用量检测请求失败：' + e.message] }
    }
  }

  const parsed = samples.map(s => {
    try { return JSON.parse(s.raw) } catch { return null }
  })

  const anomalies = []
  const usages = parsed.map(p => p?.usage || null)
  const hasUsage = usages.some(u => u != null)
  if (!hasUsage) {
    return {
      available: false,
      anomalies: ['⚠ 返回未包含 usage 字段，无法核验 Token 计费，可能按字符或固定值计费']
    }
  }

  const first = usages.find(u => u) || {}
  const promptTokens = first.prompt_tokens ?? first.promptTokens
  const completionTokens = first.completion_tokens ?? first.completionTokens
  const totalTokens = first.total_tokens ?? first.totalTokens

  // 估算：中文约 1 字 1 token
  const estPrompt = estimateTokens(KNOWN_PROMPT)
  const completionText = parsed
    .map(p => p?.choices?.[0]?.message?.content || '')
    .filter(Boolean).join('')
  const estCompletion = estimateTokens(completionText)

  const detail = {
    hasUsage: true,
    reported: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: totalTokens },
    estimated: { prompt: estPrompt, completion: estCompletion }
  }

  // 检查 prompt_tokens 合理性
  if (promptTokens == null) {
    anomalies.push('⚠ usage 缺少 prompt_tokens 字段')
  } else if (promptTokens === 0) {
    anomalies.push('⚠ prompt_tokens = 0，明显伪造')
  } else if (promptTokens < estPrompt * 0.3 || promptTokens > estPrompt * 3) {
    anomalies.push(`⚠ prompt_tokens=${promptTokens} 与估算 ${estPrompt} 偏差过大，疑似伪造`)
  }

  // 多次同输入 prompt_tokens 应稳定
  const allPrompt = usages.filter(u => u).map(u => u.prompt_tokens ?? u.promptTokens).filter(Number.isFinite)
  if (allPrompt.length >= 2) {
    const diff = Math.abs(allPrompt[0] - allPrompt[1])
    if (diff > estPrompt * 0.2) {
      anomalies.push(`⚠ 相同输入两次 prompt_tokens 不一致（${allPrompt[0]} vs ${allPrompt[1]}），疑似伪造`)
    }
  }

  // completion 合理性
  if (completionTokens != null && estCompletion > 0) {
    if (completionTokens < estCompletion * 0.3 || completionTokens > estCompletion * 3) {
      anomalies.push(`⚠ completion_tokens=${completionTokens} 与估算 ${estCompletion} 偏差过大`)
    }
  }

  return { available: true, detail, anomalies }
}

function estimateTokens(text) {
  let t = 0
  for (const ch of text) {
    if (/[一-鿿㐀-䶿豈-﫿]/.test(ch)) t += 1
    else if (/\s/.test(ch)) t += 0.25
    else t += 0.25
  }
  return Math.round(t)
}
