/**
 * 上下文长度支持测试
 * 递增长度的输入，检测中转是否偷偷截断上下文、或在较小长度就报错。
 * 会在文末埋一个“回声指令”，正常模型应能从长文本里取出并复述该指令。
 */
import { runNonStreamTest } from './request.mjs'

const ECHO_MARKER = 'ZHAOYIZE_ECHO_7421'
const SUFFIX = `\n\n请只回复上面文本中出现的标记码（一串大写字母和数字），不要回复其他任何内容。标记码是：${ECHO_MARKER}。请准确复述它。`

// 生成约 targetChars 字符的填充文本，标记码藏在中间
function buildLongPrompt(targetChars) {
  const filler = '人工智能是计算机科学的一个分支，它企图了解智能的实质，并生产出一种新的能以人类智能相似的方式做出反应的智能机器。'.repeat(50)
  const half = Math.floor(targetChars / 2)
  const head = filler.slice(0, half)
  const tail = filler.slice(0, targetChars - half - ECHO_MARKER.length)
  return head + ECHO_MARKER + tail + SUFFIX
}

export async function runContextLengthTest({ url, headers, model }) {
  // 测试档位：约 2K / 8K / 32K 字符
  const tiers = [
    { label: '约2K', chars: 2000 },
    { label: '约8K', chars: 8000 },
    { label: '约32K', chars: 32000 }
  ]

  const results = []
  const anomalies = []
  let maxSupportedTier = null

  for (const tier of tiers) {
    const body = {
      model,
      messages: [{ role: 'user', content: buildLongPrompt(tier.chars) }],
      stream: false,
      max_tokens: 200
    }
    try {
      const res = await runNonStreamTest({ url, headers, body, addNonce: false })
      const text = res.responseText || ''
      const recalled = text.includes(ECHO_MARKER)
      // HTTP 413 / 400 且含 context/length 关键词 → 拒绝该长度
      const rejected = res.status === 413 || (res.status === 400 && /context|length|token|too long|过长|超出/i.test(text))
      const entry = {
        tier: tier.label,
        chars: tier.chars,
        status: res.status,
        recalled,
        rejected,
        responseLen: text.length,
        totalTime: Math.round(res.totalTime)
      }
      results.push(entry)

      if (rejected) {
        entry.note = '中转在该长度拒绝（context 超限）'
        break // 更长的也必然失败，停止
      }
      if (!recalled && !rejected) {
        anomalies.push(`⚠ ${tier.label} 上下文未能取回埋藏标记，疑似上下文被截断或模型未读到全文`)
      }
      if (!rejected) maxSupportedTier = tier.label
    } catch (e) {
      results.push({ tier: tier.label, chars: tier.chars, error: e.message })
      anomalies.push(`⚠ ${tier.label} 上下文请求失败：${e.message}`)
      break
    }
  }

  return { tiers: results, maxSupportedTier, anomalies }
}
