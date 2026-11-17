import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ReviewSheetRow, VerifyCheck, VerifyResult } from '@/data/types'

// 设备群组证据的跨模块编排：设备画像（device）× 对比任务（cohortcmp）→ 设备群组差异数据报告。
// 页面组件不做业务判断，生成、冲突拦截、仲裁与核对都收在这里。

const EVIDENCE_KEY = 'devicegroup'
const DEVICE_KEY = 'device'
const COHORT_KEY = 'cohortcmp'

// 同时操作请求的互斥锁：只写入首个新生成的设备群组差异数据报告，后到请求在 TTL 内被拦住。
const LOCK_KEY = 'behavior-event-trace-hub:devicegroup-lock'
const LOCK_TTL_MS = 1000

/** 版本冲突的两种仲裁边界：画像确认时间 / 对比任务归属版本。 */
export type ArbitrationPolicy = '画像确认时间' | '对比任务归属版本'

export const ARBITRATION_POLICIES: ArbitrationPolicy[] = ['画像确认时间', '对比任务归属版本']

function hasReport(row: EntryRow): boolean {
  const report = String(row['差异数据报告'] ?? '')
  return report !== '' && report !== '待生成'
}

function findByNo(rows: EntryRow[], field: string, no: string): EntryRow | undefined {
  return rows.find((row) => String(row[field] ?? '') === no)
}

function lockHeld(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) {
    return false
  }
  try {
    const raw = window.localStorage.getItem(LOCK_KEY)
    if (!raw) {
      return false
    }
    const held = JSON.parse(raw) as { at?: number }
    return typeof held.at === 'number' && Date.now() - held.at < LOCK_TTL_MS
  } catch {
    return false
  }
}

function stampLock(): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  window.localStorage.setItem(LOCK_KEY, JSON.stringify({ at: Date.now() }))
}

function nextNo(rows: EntryRow[], field: string, prefix: string): string {
  let max = 0
  for (const row of rows) {
    const match = new RegExp(`^${prefix}-(\\d+)$`).exec(String(row[field] ?? ''))
    if (match) {
      max = Math.max(max, Number(match[1]))
    }
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`
}

function sameWindow(a: unknown, b: unknown): boolean {
  const sa = String(a ?? '')
  const sb = String(b ?? '')
  return sa.length >= 10 && sb.length >= 10 && sa.slice(0, 10) === sb.slice(0, 10)
}

/** 登记设备群组证据：把待处理的设备画像与对比任务读到同一口径，快照三项核对字段。 */
export function registerDeviceGroupEvidence(profileNo: string, taskNo: string): ActionResult {
  const profile = findByNo(listRows(DEVICE_KEY), '画像编号', profileNo)
  if (!profile) {
    return { ok: false, message: `没有找到画像编号为 ${profileNo} 的设备画像` }
  }
  const task = findByNo(listRows(COHORT_KEY), '任务编号', taskNo)
  if (!task) {
    return { ok: false, message: `没有找到任务编号为 ${taskNo} 的对比任务` }
  }
  const rows = listRows(EVIDENCE_KEY)
  if (rows.some((row) => String(row['画像编号']) === profileNo && String(row['任务编号']) === taskNo)) {
    return { ok: false, message: `画像 ${profileNo} × 任务 ${taskNo} 的设备群组证据已登记，不用重复登记` }
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const evidence: EntryRow = {
    id,
    status: '草稿',
    pending: true,
    abnormal: false,
    证据编号: nextNo(rows, '证据编号', 'DEVG'),
    画像编号: profileNo,
    任务编号: taskNo,
    设备类型: String(profile['设备类型'] ?? ''),
    用户占比: String(profile['用户占比'] ?? ''),
    效应值: String(task['效应值'] ?? ''),
    差异数据报告: '待生成',
    归属冲突说明: '无',
    仲裁边界: '画像确认时间',
  }
  saveRows(EVIDENCE_KEY, [...rows, evidence])
  return { ok: true, message: `设备群组证据 ${evidence['证据编号']} 已登记：${profileNo} × ${taskNo}，待发起比对` }
}

/**
 * 生成设备群组差异数据报告。
 * - 同时操作请求：只写入首个新生成的报告，后到设备群组证据请求被拦住；
 * - 两个对比任务确认同一设备：只生成一份，后到任务收到归属冲突说明并保留原任务编号；
 * - 共同边界：每个用户只进入一个已确认设备群组；
 * - 同一分析窗口的版本冲突按仲裁边界处理，结论回写两个业务面读取同一口径。
 */
export function generateDeviceGroupReport(
  evidenceId: number,
  policy: ArbitrationPolicy = '画像确认时间',
): ActionResult {
  const evidences = listRows(EVIDENCE_KEY)
  const index = evidences.findIndex((row) => Number(row.id) === evidenceId)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${evidenceId} 的设备群组证据` }
  }
  const evidence = evidences[index]
  if (hasReport(evidence)) {
    return { ok: false, message: `设备群组证据已生成差异数据报告 ${evidence['差异数据报告']}，不用重复操作` }
  }
  if (String(evidence.status) !== '比对中') {
    return { ok: false, message: '设备群组证据需先「发起比对」，再生成差异数据报告' }
  }
  const profileNo = String(evidence['画像编号'])
  const taskNo = String(evidence['任务编号'])
  const devices = listRows(DEVICE_KEY)
  const tasks = listRows(COHORT_KEY)
  const profile = findByNo(devices, '画像编号', profileNo)
  if (!profile) {
    return { ok: false, message: `没有找到画像编号为 ${profileNo} 的设备画像` }
  }
  const task = findByNo(tasks, '任务编号', taskNo)
  if (!task) {
    return { ok: false, message: `没有找到任务编号为 ${taskNo} 的对比任务` }
  }

  // 同一设备只生成一份差异报告：后到任务收到归属冲突说明并保留原任务编号。
  const holder = evidences.find(
    (row) => Number(row.id) !== evidenceId && String(row['画像编号']) === profileNo && hasReport(row),
  )
  if (holder) {
    const note = `归属冲突：画像 ${profileNo} 的设备群组差异数据报告已由任务 ${holder['任务编号']} 生成（${holder['差异数据报告']}），本任务保留原任务编号 ${taskNo}，不再重复生成`
    const next = [...evidences]
    next[index] = { ...evidence, 归属冲突说明: note, abnormal: true }
    saveRows(EVIDENCE_KEY, next)
    return { ok: false, message: note }
  }

  // 共同边界：每个用户只进入一个已确认设备群组。
  const myGroups = [task['群组A'], task['群组B']].map(String)
  for (const other of evidences) {
    if (Number(other.id) === evidenceId || !hasReport(other)) {
      continue
    }
    const otherTask = findByNo(tasks, '任务编号', String(other['任务编号']))
    if (!otherTask) {
      continue
    }
    const overlap = [otherTask['群组A'], otherTask['群组B']].map(String).filter((g) => myGroups.includes(g))
    if (overlap.length > 0) {
      return {
        ok: false,
        message: `共同边界被拦住：群组「${overlap[0]}」已进入已确认设备群组（${other['证据编号']}），每个用户只进入一个已确认设备群组`,
      }
    }
  }

  // 同时操作请求：只写入首个新生成的设备群组差异数据报告，后到请求被拦住。
  if (lockHeld()) {
    return { ok: false, message: '同时操作请求被拦住：只写入首个新生成的设备群组差异数据报告，请稍后重试' }
  }
  stampLock()

  // 仲裁边界：设备归属调整与群组对比结论在同一分析窗口完成时，按所选口径留下对应报告。
  const inSameWindow = sameWindow(profile['画像确认时间'], task['结论确认时间'])
  const byTaskVersion = policy === '对比任务归属版本'
  const reportId = nextNo(evidences, '差异数据报告', byTaskVersion ? 'GRPLC' : 'GDIFF')
  const reportKind = byTaskVersion ? '任务归属优先的设备替换报告' : '画像时间隔离后的设备差异报告'
  const arbitration = byTaskVersion ? `对比任务归属版本 v${Number(task['归属版本'] ?? 1)}` : '画像确认时间'

  // 写入首个新生成的设备群组差异数据报告（同一口径快照自设备画像与对比任务）。
  const snapshot = {
    设备类型: String(profile['设备类型'] ?? ''),
    用户占比: String(profile['用户占比'] ?? ''),
    效应值: String(task['效应值'] ?? ''),
  }
  const nextEvidences = [...evidences]
  nextEvidences[index] = {
    ...evidence,
    ...snapshot,
    差异数据报告: reportId,
    仲裁边界: arbitration,
    归属冲突说明: '无',
    status: '已生成',
    pending: false,
    abnormal: false,
  }
  saveRows(EVIDENCE_KEY, nextEvidences)

  // 同一口径回写两个业务面：设备行为差异报告与对比结论读同一份报告，复核数据清单随之更新。
  saveRows(
    DEVICE_KEY,
    devices.map((row) => (Number(row.id) === Number(profile.id) ? { ...row, 行为差异报告: reportId } : row)),
  )
  saveRows(
    COHORT_KEY,
    tasks.map((row) =>
      Number(row.id) === Number(task.id)
        ? {
            ...row,
            结论描述: `已按同一口径核对：${snapshot.设备类型} 用户占比 ${snapshot.用户占比}，效应值 ${snapshot.效应值}，详见${reportKind} ${reportId}`,
          }
        : row,
    ),
  )

  const windowNote = inSameWindow ? '检测到设备归属调整与群组对比结论在同一分析窗口完成，' : ''
  return { ok: true, message: `${windowNote}已按「${arbitration}」生成${reportKind} ${reportId}，复核数据清单已更新` }
}

/** 核对设备群组证据：设备类型、用户占比、效应值读同一口径，再复验任务归属。 */
export function verifyDeviceGroupEvidence(evidenceId: number): VerifyResult {
  const evidences = listRows(EVIDENCE_KEY)
  const evidence = evidences.find((row) => Number(row.id) === evidenceId)
  if (!evidence) {
    return { ok: false, message: `没有找到编号为 ${evidenceId} 的设备群组证据`, checks: [] }
  }
  const profileNo = String(evidence['画像编号'])
  const taskNo = String(evidence['任务编号'])
  const profile = findByNo(listRows(DEVICE_KEY), '画像编号', profileNo)
  const task = findByNo(listRows(COHORT_KEY), '任务编号', taskNo)

  const checks: VerifyCheck[] = [
    {
      label: `设备类型核对（${profileNo}）`,
      pass: Boolean(profile) && String(evidence['设备类型']) === String(profile?.['设备类型']),
      detail: profile
        ? `证据「${evidence['设备类型']}」${String(evidence['设备类型']) === String(profile['设备类型']) ? '与' : '不等于'}设备画像「${profile['设备类型']}」`
        : `设备画像 ${profileNo} 不存在`,
    },
    {
      label: `用户占比核对（${profileNo}）`,
      pass: Boolean(profile) && String(evidence['用户占比']) === String(profile?.['用户占比']),
      detail: profile
        ? `证据「${evidence['用户占比']}」${String(evidence['用户占比']) === String(profile['用户占比']) ? '与' : '不等于'}设备画像「${profile['用户占比']}」`
        : `设备画像 ${profileNo} 不存在`,
    },
    {
      label: `效应值核对（${taskNo}）`,
      pass: Boolean(task) && String(evidence['效应值']) === String(task?.['效应值']),
      detail: task
        ? `证据「${evidence['效应值']}」${String(evidence['效应值']) === String(task['效应值']) ? '与' : '不等于'}对比任务「${task['效应值']}」`
        : `对比任务 ${taskNo} 不存在`,
    },
  ]

  // 复验任务归属：报告持有者唯一；被拦任务保留原任务编号并已登记归属冲突说明。
  const holder = evidences.find((row) => String(row['画像编号']) === profileNo && hasReport(row))
  let ownershipPass = false
  let ownershipDetail = ''
  if (!task) {
    ownershipDetail = `原任务编号 ${taskNo} 在群组对比中不存在`
  } else if (holder && Number(holder.id) === Number(evidence.id)) {
    ownershipPass = true
    ownershipDetail = `差异数据报告 ${evidence['差异数据报告']} 归属本任务 ${taskNo}，同一设备仅此一份`
  } else if (holder) {
    const noteKept =
      String(evidence['归属冲突说明']).includes(taskNo) && String(evidence['任务编号']) === taskNo
    ownershipPass = noteKept
    ownershipDetail = noteKept
      ? `画像 ${profileNo} 的报告由任务 ${holder['任务编号']} 持有，本证据保留原任务编号 ${taskNo} 并已登记归属冲突说明`
      : `画像 ${profileNo} 的报告由任务 ${holder['任务编号']} 持有，但本证据未正确登记归属冲突说明`
  } else {
    ownershipPass = String(evidence['任务编号']) === taskNo
    ownershipDetail = `尚未生成差异数据报告，任务归属 ${taskNo} 待生成后复验`
  }
  checks.push({ label: `任务归属复验（${taskNo}）`, pass: ownershipPass, detail: ownershipDetail })

  const ok = checks.every((check) => check.pass)
  const failed = checks.filter((check) => !check.pass).map((check) => check.label)
  return {
    ok,
    checks,
    message: ok
      ? `核对通过：${profileNo} × ${taskNo} 设备类型、用户占比、效应值一致，任务归属复验通过`
      : `核对未通过：${failed.join('、')}`,
  }
}

/** 按画像编号 × 任务编号找到证据再核对，例如 DEVI-0002 × COHO-0002。 */
export function verifyPair(profileNo: string, taskNo: string): VerifyResult {
  const evidence = listRows(EVIDENCE_KEY).find(
    (row) => String(row['画像编号']) === profileNo && String(row['任务编号']) === taskNo,
  )
  if (!evidence) {
    return { ok: false, message: `没有找到画像 ${profileNo} × 任务 ${taskNo} 对应的设备群组证据`, checks: [] }
  }
  return verifyDeviceGroupEvidence(Number(evidence.id))
}

/** 复核数据清单：随新生成的设备群组差异数据报告更新，从设备画像读到设备行为差异报告。 */
export function listReviewSheet(): ReviewSheetRow[] {
  const devices = listRows(DEVICE_KEY)
  return listRows(EVIDENCE_KEY)
    .filter(hasReport)
    .map((row) => {
      const profile = findByNo(devices, '画像编号', String(row['画像编号']))
      return {
        证据编号: String(row['证据编号'] ?? ''),
        任务编号: String(row['任务编号'] ?? ''),
        画像编号: String(row['画像编号'] ?? ''),
        设备类型: String(row['设备类型'] ?? ''),
        用户占比: String(row['用户占比'] ?? ''),
        效应值: String(row['效应值'] ?? ''),
        行为差异报告: String(profile?.['行为差异报告'] ?? '—'),
        差异数据报告: String(row['差异数据报告'] ?? ''),
        仲裁边界: String(row['仲裁边界'] ?? ''),
      }
    })
    .sort((a, b) => a.证据编号.localeCompare(b.证据编号))
}
