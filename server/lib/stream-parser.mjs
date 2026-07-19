/**
 * SSE 流式解析器
 * 解析 OpenAI 兼容的流式响应，记录每个 chunk 的到达时间和内容
 */
export class StreamParser {
  buffer = ''
  chunks = []  // { timeOffset: number (ms), content: string, raw: string }

  /**
   * 写入原始字节数据
   */
  feed(chunkText, relativeTime) {
    this.buffer += chunkText
    this._processBuffer(relativeTime)
  }

  _processBuffer(relativeTime) {
    const lines = this.buffer.split('\n')
    // 最后一行可能不完整，保留在 buffer 中
    this.buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      if (trimmed.startsWith('data:')) {
        const data = trimmed.slice(5).trim()
        this.chunks.push({
          timeOffset: relativeTime,
          content: data,
          raw: line
        })
      }
    }
  }

  /**
   * 结束解析，处理剩余 buffer
   */
  end(relativeTime) {
    if (this.buffer.trim()) {
      const trimmed = this.buffer.trim()
      if (trimmed.startsWith('data:')) {
        const data = trimmed.slice(5).trim()
        this.chunks.push({
          timeOffset: relativeTime,
          content: data,
          raw: this.buffer
        })
      }
    }
    this.buffer = ''
  }

  /**
   * 获取所有非 DONE 的数据内容
   */
  getDataChunks() {
    return this.chunks.filter(c => c.content !== '[DONE]')
  }

  /**
   * 获取拼接后的完整文本
   */
  getFullText() {
    let text = ''
    for (const c of this.getDataChunks()) {
      try {
        const parsed = JSON.parse(c.content)
        const delta = parsed.choices?.[0]?.delta?.content
        if (delta) text += delta
      } catch { /* 非 JSON 数据行，跳过 */ }
    }
    return text
  }

  /**
   * 获取原始响应内容列表（用于相似度对比）
   */
  getRawContents() {
    return this.getDataChunks().map(c => c.content)
  }

  /**
   * 获取 chunk 时间序列（用于节奏分析）
   */
  getTimeSeries() {
    return this.getDataChunks().map(c => c.timeOffset)
  }

  /**
   * 获取完整统计
   */
  getStats() {
    const dataChunks = this.getDataChunks()
    if (dataChunks.length === 0) return null

    const times = dataChunks.map(c => c.timeOffset)
    const intervals = []
    for (let i = 1; i < times.length; i++) {
      intervals.push(times[i] - times[i - 1])
    }

    const fullText = this.getFullText()
    // 简单估算 token 数：中文约 1 字 1 token，英文约 4 字符 1 token
    const estimatedTokens = estimateTokens(fullText)

    // 首 chunk 占比
    const firstChunkContent = dataChunks[0]?.content || ''
    const totalContentLength = dataChunks.reduce((s, c) => s + c.content.length, 0)
    const firstChunkRatio = totalContentLength > 0 ? firstChunkContent.length / totalContentLength : 0

    return {
      totalChunks: dataChunks.length,
      totalChars: fullText.length,
      estimatedTokens,
      firstChunkRatio,
      timeToFirstToken: times[0],
      timeToLastToken: times[times.length - 1],
      totalTime: times.length > 0 ? times[times.length - 1] - times[0] : 0,
      intervals,
      avgInterval: intervals.length > 0 ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0,
      intervalVariance: calculateVariance(intervals),
      tokensPerSec: (times[times.length - 1] - times[0]) > 0
        ? (estimatedTokens / ((times[times.length - 1] - times[0]) / 1000))
        : 0
    }
  }
}

function estimateTokens(text) {
  let tokens = 0
  for (const char of text) {
    // CJK 字符范围
    if (/[一-鿿㐀-䶿豈-﫿]/.test(char)) {
      tokens += 1
    } else if (/\s/.test(char)) {
      tokens += 0.25
    } else {
      tokens += 0.25
    }
  }
  return Math.round(tokens)
}

function calculateVariance(arr) {
  if (arr.length === 0) return 0
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length
  const sqDiffs = arr.map(v => (v - mean) ** 2)
  return sqDiffs.reduce((a, b) => a + b, 0) / arr.length
}
