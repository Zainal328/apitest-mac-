import Fastify from 'fastify'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { analyzeTestRuns } from './lib/analyze.mjs'
import { runNonStreamTest, runStreamTest } from './lib/request.mjs'
import { comprehensiveTest } from './lib/comprehensive.mjs'
import { loadHistory, saveRecord, deleteRecord, clearAll } from './lib/history.mjs'
import { aiEvaluate } from './lib/ai-evaluate.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export async function startServer({ preferredPort = 3000 } = {}) {
  const app = Fastify({ logger: false })

  app.get('/', async (req, reply) => {
    const indexPath = path.join(__dirname, '..', 'web', 'index.html')
    const { readFile } = await import('node:fs/promises')
    const html = await readFile(indexPath, 'utf8')
    reply.type('text/html').send(html)
  })

  app.get('/api/health', async () => ({ ok: true }))

  app.post('/api/comprehensive-test', async (request, reply) => {
    const { url, key, model } = request.body || {}
    if (!url || !key || !model) {
      reply.code(400)
      return { error: 'url, key, and model are required' }
    }
    const startTime = Date.now()
    try {
      const result = await comprehensiveTest({ url, key, model })
      const record = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        url, model,
        duration: Date.now() - startTime,
        summary: {
          scorecard: result.analysis?.scorecard || null,
          streamTtfb: result.analysis?.streamTtfb,
          streamTps: result.analysis?.streamTps,
          streamTotal: result.analysis?.streamTotal,
          streamWindow: result.analysis?.streamWindow,
          streamChunks: result.analysis?.streamChunks,
          longTime: result.analysis?.longTime,
          repeatIdenticalRate: result.analysis?.repeatIdenticalRate,
          intelScore: result.analysis?.intelResult?.score,
          modelType: result.analysis?.modelType,
          concurrency: result.analysis?.concurrency || null,
          cornerCutting: result.analysis?.cornerCutting || null,
          contextLength: result.analysis?.contextLength || null,
          usage: result.analysis?.usage || null,
          anomalies: result.analysis?.anomalies || []
        },
        fullReport: result
      }
      await saveRecord(record)
      return { ...result, _recordId: record.id }
    } catch (error) {
      reply.code(502)
      return { error: error.message }
    }
  })

  app.get('/api/history', async () => {
    const history = await loadHistory()
    // Return summary only, not full report (faster)
    return history.map(r => ({
      id: r.id,
      timestamp: r.timestamp,
      url: r.url,
      model: r.model,
      duration: r.duration,
      summary: r.summary
    }))
  })

  app.get('/api/history/:id', async (request, reply) => {
    const history = await loadHistory()
    const record = history.find(r => r.id === request.params.id)
    if (!record) {
      reply.code(404)
      return { error: 'not found' }
    }
    return record
  })

  app.delete('/api/history/:id', async (request, reply) => {
    const remaining = await deleteRecord(request.params.id)
    return { ok: true, remaining }
  })

  app.delete('/api/history', async () => {
    await clearAll()
    return { ok: true }
  })

  app.post('/api/test', async (request, reply) => {
    const {
      url, headers = {}, body = {}, stream = true, repeat = 1, addNonce = true
    } = request.body || {}
    if (!url) { reply.code(400); return { error: 'url is required' } }
    const runs = []
    for (let i = 0; i < repeat; i++) {
      const run = stream
        ? await runStreamTest({ url, headers, body, addNonce })
        : await runNonStreamTest({ url, headers, body, addNonce })
      runs.push(run)
    }
    return { runs, analysis: analyzeTestRuns(runs) }
  })

  app.post('/api/ai-evaluate', async (request, reply) => {
    const { report, evaluatorUrl, evaluatorKey, evaluatorModel } = request.body || {}
    if (!report) { reply.code(400); return { error: 'report is required' } }
    try {
      return await aiEvaluate({ report, evaluatorUrl, evaluatorKey, evaluatorModel })
    } catch (e) {
      reply.code(502)
      return { ok: false, error: e.message }
    }
  })

  // Find a free port starting from preferredPort
  const { createServer } = await import('node:net')
  const tryPorts = [preferredPort]
  for (let i = 1; i <= 10; i++) tryPorts.push(preferredPort + i)

  let chosenPort = null
  for (const p of tryPorts) {
    const ok = await new Promise((resolve) => {
      const tester = createServer()
        .once('error', () => resolve(false))
        .once('listening', () => tester.close(() => resolve(true)))
        .listen(p, '127.0.0.1')
    })
    if (ok) { chosenPort = p; break }
  }
  if (!chosenPort) throw new Error('No available port')

  await app.listen({ port: chosenPort, host: '127.0.0.1' })
  return { app, port: chosenPort }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { app: server, port } = await startServer()
  console.log('Server running at http://localhost:' + port)
  // Keep process alive
  process.on('SIGINT', async () => { await server.close(); process.exit(0) })
  process.on('SIGTERM', async () => { await server.close(); process.exit(0) })
}