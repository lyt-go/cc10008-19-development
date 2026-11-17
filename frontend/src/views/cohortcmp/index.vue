<template>
  <section class="page" data-module="cohortcmp">
    <header class="page-head">
      <div>
        <h2>群组对比管理</h2>
        <p class="page-desc">对比分析不同用户群组在行为指标上的差异，量化群组间效果。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记对比任务</button>
        <button class="btn" type="button" @click="exportRows">导出群组对比清单</button>
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

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
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
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无群组对比数据，可先登记对比任务</td>
        </tr>
      </tbody>
    </table>

    <section class="review-sheet">
      <h3>复核数据清单（随设备群组差异数据报告更新）</h3>
      <p class="page-desc">从设备画像读到设备行为差异报告，跨模块衔接设备群组差异，对比结论与设备侧读取同一口径。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in reviewColumns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in reviewRows" :key="row.证据编号">
            <td v-for="column in reviewColumns" :key="column">{{ row[column] }}</td>
          </tr>
          <tr v-if="!reviewRows.length">
            <td :colspan="reviewColumns.length" class="empty-state">暂无已生成的设备群组差异数据报告，可先在设备群组证据中生成</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条群组对比记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { listReviewSheet } from '@/api/device-group-service'
import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, ReviewSheetRow } from '@/data/types'

const meta = moduleMeta('cohortcmp')
const columns = ["任务编号", "群组A", "群组B", "对比维度", "时间对齐方式", "统计检验", "效应值", "结论描述"]
const actions = ["启动对比", "确认结论", "归档结论"]
const statuses = ["草稿", "对比计算中", "已确认", "已归档"]
const stats = [{"label": "对比任务总数", "value": 0}, {"label": "已确认任务", "value": 0}, {"label": "计算中任务", "value": 0}]
const reviewColumns = ["证据编号", "任务编号", "画像编号", "设备类型", "用户占比", "效应值", "行为差异报告", "差异数据报告", "仲裁边界"] as const

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const reviewRows = ref<ReviewSheetRow[]>([])
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

function openCreate() {
  errorMessage.value = '对比任务登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    reviewRows.value = listReviewSheet()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '群组对比列表读取失败'
  }
}

onMounted(reload)
</script>
