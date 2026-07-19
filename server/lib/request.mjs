/**
 * 请求计时与发起模块
 */
import { StreamParser } from './stream-parser.mjs'

/**
 * 执行单次非流式请求
 */
export async function runNonStreamTest({ url, headers, body, addNonce = false }) {
  const reqBody = addNonce ? addNonceToBody(body) : body

  const t0 = performance.now()
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      ...headers
    },
    body: JSON.stringify(reqBody)
  })

  // 读取首字节
  const reader = response.body.getReader()
  const firstByteResult = await reader.read()
  const tFirstByte = performance.now()
  const ttfb = tFirstByte - t0

  // 累积全部响应
  const decoder = new TextDecoder()
  let fullText = ''
  if (firstByteResult.value) {
    fullText += decoder.decode(firstByteResult.value, { stream: true })
  }
  let readResult
  while (!(readResult = await reader.read()).done) {
    if (readResult.value) {
      fullText += decoder.decode(readResult.value, { stream: true })
    }
  }
  // flush decoder
  fullText += decoder.decode()

  const tEnd = performance.now()
  const totalTime = tEnd - t0
  const downloadTime = tEnd - tFirstByte

  return {
    ttfb,
    totalTime,
    downloadTime,
    firstByteTime: tFirstByte - t0,
    status: response.status,
    statusText: response.statusText,
    responseHeaders: Object.fromEntries(response.headers.entries()),
    responseText: fullText,
    responseLength: fullText.length
  }
}

/**
 * 执行单次流式请求
 */
export async function runStreamTest({ url, headers, body, addNonce = false }) {
  const reqBody = addNonce ? addNonceToBody(body) : { ...body, stream: true }

  const t0 = performance.now()
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      ...headers
    },
    body: JSON.stringify(reqBody)
  })

  const parser = new StreamParser()
  let firstByteTime = null

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let readResult

  while (!(readResult = await reader.read()).done) {
    const now = performance.now()
    if (firstByteTime === null) {
      firstByteTime = now
    }
    const relativeTime = now - t0
    if (readResult.value) {
      const text = decoder.decode(readResult.value, { stream: true })
      parser.feed(text, relativeTime)
    }
  }
  // Flush decoder
  const flushText = decoder.decode()
  if (flushText) {
    const endTime = performance.now()
    parser.feed(flushText, endTime - t0)
  }
  const tEnd = performance.now()
  parser.end(tEnd - t0)

  const ttfb = firstByteTime !== null ? firstByteTime - t0 : tEnd - t0
  const totalTime = tEnd - t0
  const stats = parser.getStats()

  return {
    ttfb,
    totalTime,
    status: response.status,
    statusText: response.statusText,
    responseHeaders: Object.fromEntries(response.headers.entries()),
    rawChunks: parser.chunks,
    dataChunks: parser.getDataChunks().map(c => ({ timeOffset: c.timeOffset, content: c.content })),
    timeSeries: parser.getTimeSeries(),
    fullText: parser.getFullText(),
    stats
  }
}

function addNonceToBody(body) {
  // 在最后一条 user message 末尾追加随机 nonce
  const b = JSON.parse(JSON.stringify(body))
  if (b.messages && b.messages.length > 0) {
    const last = b.messages[b.messages.length - 1]
    if (last.content && typeof last.content === 'string') {
      last.content += ` [nonce:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}]`
    }
  }
  return b
}
