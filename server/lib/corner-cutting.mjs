/**
 * 偷工减料检测
 * 原理：用一道有确定答案的题，以两种不同表述方式提问。
 *  - 正常模型两次都应答对。
 *  - 若中转偷偷降低 max_tokens、换更小的模型、或截断响应，
 *    会出现：答错、两次答案不一致、响应异常短。
 */
import { runNonStreamTest } from './request.mjs'

// 固定答案题：答案应为 56088
const CALC_ANSWER = 56088
const PROMPT_A = '请直接计算 123 × 456 的结果，只回答数字本身，不要任何解释。'
const PROMPT_B = '我现在需要一个数学计算结果。题目是：一百二十三乘以四百五十六等于多少？请只给出阿拉伯数字结果。'
// 开放题：正常应给出多个要点
const OPEN_PROMPT = '请列举 Python 中最常用的 5 种数据类型，每行一个，简要说明。'

export async function runCornerCuttingTest({ url, headers, model }) {
  const mkBody = (prompt) => ({
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    max_tokens: 2000
  })

  const out = { checks: [], anomalies: [] }

  // 检查 1：固定答案题一致性
  let resA, resB
  try {
    resA = await runNonStreamTest({ url, headers, body: mkBody(PROMPT_A), addNonce: false })
    resB = await runNonStreamTest({ url, headers, body: mkBody(PROMPT_B), addNonce: false })
  } catch (e) {
    out.checks.push({ name: '固定答案题', ok: false, error: e.message })
    out.anomalies.push('⚠ 偷工减料检测请求失败：' + e.message)
    return out
  }

  const ansA = extractNumber(resA.responseText)
  const ansB = extractNumber(resB.responseText)
  const bothCorrect = ansA === CALC_ANSWER && ansB === CALC_ANSWER
  const consistent = ansA === ansB

  out.checks.push({
    name: '固定答案题一致性',
    ok: bothCorrect,
    detail: {
      expected: CALC_ANSWER,
      answerA: ansA,
      answerB: ansB,
      responseLenA: resA.responseText?.length || 0,
      responseLenB: resB.responseText?.length || 0,
      timeA: Math.round(resA.totalTime),
      timeB: Math.round(resB.totalTime)
    }
  })
  if (!bothCorrect) {
    out.anomalies.push(`⚠ 计算题答案错误：期望 ${CALC_ANSWER}，实际 A=${ansA} B=${ansB}，可能换了更弱的模型`)
  } else if (!consistent) {
    out.anomalies.push(`⚠ 两次计算答案不一致（A=${ansA}, B=${ansB}），结果不稳定`)
  }

  // 检查 2：开放题响应长度（疑似截断/降级）
  let resOpen
  try {
    resOpen = await runNonStreamTest({ url, headers, body: mkBody(OPEN_PROMPT), addNonce: false })
  } catch (e) {
    out.checks.push({ name: '开放题响应长度', ok: false, error: e.message })
    return out
  }
  const openLen = resOpen.responseText?.length || 0
  // 要求列举 5 种数据类型，正常应 > 80 字符
  const openOk = openLen >= 80
  out.checks.push({
    name: '开放题响应长度',
    ok: openOk,
    detail: { length: openLen, threshold: 80 }
  })
  if (!openOk) {
    out.anomalies.push(`⚠ 开放题响应仅 ${openLen} 字符（要求列举 5 项），疑似 max_tokens 被调低或响应被截断`)
  }

  // 检查 3：两种表述的耗时差异（疑似按表述路由到不同后端）
  const timeDiff = Math.abs(resA.totalTime - resB.totalTime)
  out.checks.push({
    name: '不同表述耗时一致性',
    ok: timeDiff < Math.max(resA.totalTime, resB.totalTime) * 0.5,
    detail: { timeA: Math.round(resA.totalTime), timeB: Math.round(resB.totalTime), diff: Math.round(timeDiff) }
  })
  if (timeDiff > Math.max(resA.totalTime, resB.totalTime) * 0.5) {
    out.anomalies.push(`⚠ 同一题不同表述耗时差异 ${Math.round(timeDiff)}ms，疑似按 prompt 内容路由到不同质量后端`)
  }

  return out
}

function extractNumber(text) {
  if (!text) return null
  const m = text.match(/\d+/)
  return m ? parseInt(m[0], 10) : null
}
