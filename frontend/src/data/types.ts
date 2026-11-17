/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 设备群组证据的核对结果：逐项列出核对点，页面直接渲染。 */
export type VerifyCheck = {
  label: string
  pass: boolean
  detail: string
}

export type VerifyResult = {
  ok: boolean
  message: string
  checks: VerifyCheck[]
}

/** 复核数据清单的一行：从设备画像读到设备行为差异报告，跨模块同一口径。 */
export type ReviewSheetRow = {
  证据编号: string
  任务编号: string
  画像编号: string
  设备类型: string
  用户占比: string
  效应值: string
  行为差异报告: string
  差异数据报告: string
  仲裁边界: string
}
