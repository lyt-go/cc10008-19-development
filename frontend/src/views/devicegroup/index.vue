<template>
  <section class="page" data-module="devicegroup">
    <header class="page-head">
      <div>
        <h2>设备群组证据管理</h2>
        <p class="page-desc">把待处理的设备画像与对比任务读到同一口径，生成设备群组差异数据报告，并维护复核数据清单。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="toggleCreate">登记设备群组证据</button>
        <button class="btn" type="button" @click="verifyDefaultPair">核对 DEVI-0002 × COHO-0002</button>
        <button class="btn" type="button" @click="exportRows">导出设备群组证据清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form v-if="createOpen" class="filter-bar" @submit.prevent="submitCreate">
      <label class="filter-item">
        <span>画像编号</span>
        <select v-model="createProfileNo">
          <option v-for="no in profileOptions" :key="no" :value="no">{{ no }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>任务编号</span>
        <select v-model="createTaskNo">
          <option v-for="no in taskOptions" :key="no" :value="no">{{ no }}</option>
        </select>
      </label>
      <button class="btn primary" type="submit">确认登记</button>
      <button class="btn ghost" type="button" @click="toggleCreate">取消</button>
    </form>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <label class="filter-item">
        <span>仲裁边界</span>
        <select v-model="arbitrationPolicy">
          <option v-for="policy in arbitrationPolicies" :key="policy" :value="policy">{{ policy }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="verifyRow(row)">核对复验</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无设备群组证据数据，可先登记设备群组证据</td>
        </tr>
      </tbody>
    </table>

    <section v-if="verifyResult" class="verify-panel" :class="{ failed: !verifyResult.ok }">
      <h3>核对复验结果</h3>
      <p class="verify-summary">{{ verifyResult.message }}</p>
      <ul class="verify-list">
        <li v-for="check in verifyResult.checks" :key="check.label">
          <span :class="check.pass ? 'verify-pass' : 'verify-fail'">{{ check.pass ? '✓' : '✗' }}</span>
          <strong>{{ check.label }}</strong>：{{ check.detail }}
        </li>
      </ul>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条设备群组证据记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  ARBITRATION_POLICIES,
  generateDeviceGroupReport,
  registerDeviceGroupEvidence,
  verifyDeviceGroupEvidence,
  verifyPair,
  type ArbitrationPolicy,
} from '@/api/device-group-service'
import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, VerifyResult } from '@/data/types'

const meta = moduleMeta('devicegroup')
const columns = ["证据编号", "画像编号", "任务编号", "设备类型", "用户占比", "效应值", "差异数据报告", "归属冲突说明", "仲裁边界"]
const actions = ["发起比对", "生成差异报告", "归档证据"]
const statuses = ["草稿", "比对中", "已生成", "已归档"]
const stats = [{"label": "设备群组证据总数", "value": 0}, {"label": "已生成差异报告", "value": 0}, {"label": "归属冲突数", "value": 0}]
const arbitrationPolicies = ARBITRATION_POLICIES

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const arbitrationPolicy = ref<ArbitrationPolicy>('画像确认时间')
const verifyResult = ref<VerifyResult | null>(null)
const createOpen = ref(false)
const createProfileNo = ref('')
const createTaskNo = ref('')
const profileOptions = ref<string[]>([])
const taskOptions = ref<string[]>([])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function toggleCreate() {
  createOpen.value = !createOpen.value
  if (createOpen.value) {
    profileOptions.value = listEntries('device').items.map((row) => String(row['画像编号']))
    taskOptions.value = listEntries('cohortcmp').items.map((row) => String(row['任务编号']))
    createProfileNo.value = profileOptions.value[0] ?? ''
    createTaskNo.value = taskOptions.value[0] ?? ''
  }
}

function submitCreate() {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = registerDeviceGroupEvidence(createProfileNo.value, createTaskNo.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  createOpen.value = false
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  verifyResult.value = null
  if (action === '生成差异报告') {
    const result = generateDeviceGroupReport(Number(row.id), arbitrationPolicy.value)
    if (!result.ok) {
      errorMessage.value = result.message
    } else {
      noticeMessage.value = result.message
    }
    reload()
    return
  }
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function verifyRow(row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  verifyResult.value = verifyDeviceGroupEvidence(Number(row.id))
}

function verifyDefaultPair() {
  errorMessage.value = ''
  noticeMessage.value = ''
  verifyResult.value = verifyPair('DEVI-0002', 'COHO-0002')
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '设备群组证据列表读取失败'
  }
}

onMounted(reload)
</script>
