/**
 * 历史记录持久化
 * 使用文件存储，每次测试后自动保存
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const HISTORY_FILE = path.join(os.homedir(), '.api-speed-tester-history.json')
const MAX_RECORDS = 50

export async function loadHistory() {
  try {
    const data = await fs.readFile(HISTORY_FILE, 'utf8')
    return JSON.parse(data)
  } catch (e) {
    if (e.code === 'ENOENT') return []
    throw e
  }
}

export async function saveRecord(record) {
  const history = await loadHistory()
  // Insert at the beginning
  history.unshift(record)
  // Trim
  if (history.length > MAX_RECORDS) history.length = MAX_RECORDS
  await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2))
  return record
}

export async function deleteRecord(id) {
  const history = await loadHistory()
  const filtered = history.filter(r => r.id !== id)
  await fs.writeFile(HISTORY_FILE, JSON.stringify(filtered, null, 2))
  return filtered.length
}

export async function clearAll() {
  await fs.writeFile(HISTORY_FILE, '[]')
}