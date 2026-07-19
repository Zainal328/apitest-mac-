/**
 * AI 点评：调用一个第三方大模型，让它对测试数据进行自然语言解读
 * 用户提供要点评的 API，但点评本身需要一次健康的 API 调用，所以默认走 GLM
 */
import { runNonStreamTest } from './request.mjs'

const EVALUATOR_PROMPT = `你是一位 API 服务质量评估专家。请基于以下中转 API 的测试数据，给出 300-500 字的自然语言评估报告。

【测试数据】
- 模型：{model}
- 服务地址：{url}
- 流式 TTFB：{streamTtfb} ms
- 流式 Token/s（估算）：{streamTps}
- 流式总耗时：{streamTotal} ms
- 流式窗口：{streamWindow} ms
- Chunk 数：{streamChunks}
- 非流式长文本耗时：{longTime} ms
- 非流式返回字符：{longLen}
- 短请求耗时：{shortTime} ms
- 重复响应一致率：{repeatRate}%
- 智能化测试得分：{intelScore}/100（满分 100，水桶问题）
- 模型识别：{modelType}
- 原始警告列表：{anomalies}

请按以下结构输出：
1. **总体结论**：用一两句话给出是否推荐使用
2. **速度评估**：TTFB 和 token 速度相对于行业真实值的判断
3. **流式真实性**：是否真的逐 token 生成，还是伪装
4. **缓存嫌疑**：重复一致率和 144ms 类异常速度对应的可能性
5. **智能化能力**：基于得分给出定性评价（如果识别为推理型则说明）
6. **最终建议**：是否值得使用，给出明确的购买/避坑建议

请用专业但易懂的中文回答，避免堆砌术语。`

export async function aiEvaluate({ report, evaluatorUrl, evaluatorKey, evaluatorModel }) {
  if (!evaluatorUrl || !evaluatorKey || !evaluatorModel) {
    return {
      ok: false,
      error: 'missing-evaluator-config',
      hint: '请提供点评用的 Base URL、Key 和模型 ID'
    }
  }

  const summary = report.summary || {}
  const prompt = EVALUATOR_PROMPT
    .replace('{model}', report.model || '-')
    .replace('{url}', report.url || '-')
    .replace('{streamTtfb}', summary.streamTtfb != null ? summary.streamTtfb : '-')
    .replace('{streamTps}', summary.streamTps != null ? summary.streamTps : '-')
    .replace('{streamTotal}', summary.streamTotal != null ? summary.streamTotal : '-')
    .replace('{streamWindow}', summary.streamWindow != null ? summary.streamWindow : '-')
    .replace('{streamChunks}', summary.streamChunks != null ? summary.streamChunks : '-')
    .replace('{longTime}', summary.longTime != null ? summary.longTime : '-')
    .replace('{longLen}', summary.longLen != null ? summary.longLen : '-')
    .replace('{shortTime}', summary.shortTime != null ? summary.shortTime : '-')
    .replace('{repeatRate}', summary.repeatIdenticalRate != null ? summary.repeatIdenticalRate : '-')
    .replace('{intelScore}', summary.intelScore != null ? summary.intelScore : '-')
    .replace('{modelType}', summary.modelType || '-')
    .replace('{anomalies}', summary.anomalies ? summary.anomalies.join('；') : '无')

  const fullUrl = evaluatorUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '') + '/v1/chat/completions'

  try {
    const res = await runNonStreamTest({
      url: fullUrl,
      headers: { 'Authorization': 'Bearer ' + evaluatorKey },
      body: {
        model: evaluatorModel,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1500,
        temperature: 0.4
      },
      addNonce: false
    })

    if (res.status < 200 || res.status >= 300) {
      return { ok: false, error: 'api-error', status: res.status, body: res.responseText }
    }

    let parsed
    try {
      parsed = JSON.parse(res.responseText)
    } catch (e) {
      return { ok: false, error: 'parse-failed', body: res.responseText.substring(0, 500) }
    }

    const content = parsed.choices?.[0]?.message?.content || ''
    if (!content) return { ok: false, error: 'empty-content', body: parsed }

    return {
      ok: true,
      evaluation: content,
      evaluatorModel,
      evaluatorUrl,
      tokens: parsed.usage?.total_tokens || null,
      took: res.totalTime
    }
  } catch (e) {
    return { ok: false, error: 'request-failed', message: e.message }
  }
}