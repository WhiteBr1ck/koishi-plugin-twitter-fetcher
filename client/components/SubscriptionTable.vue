<template>
  <SchemaBase
    v-bind="$attrs"
    :schema="schema"
    :model-value="modelValue"
    :disabled="disabled"
    :prefix="prefix"
    :initial="initial"
    :extra="extra"
  >
    <template #title><slot name="title" /></template>
    <template #desc><slot name="desc" /></template>
    <template #menu><slot name="menu" /></template>
    <template #prefix><slot name="prefix" /></template>
    <template #suffix><slot name="suffix" /></template>
    <template #control>
      <el-button type="primary" plain :disabled="disabled" @click="addRow">添加订阅</el-button>
    </template>

    <div v-if="rows.length" class="twitter-subscription-table-wrap">
      <table class="twitter-subscription-table">
        <thead>
          <tr>
            <th scope="col">{{ isHashtag ? '话题标签' : '用户名' }}</th>
            <th scope="col">推送群</th>
            <th scope="col">排除转推</th>
            <th v-if="isHashtag" scope="col">排除回复</th>
            <th scope="col">内容筛选</th>
            <th v-if="isHashtag" scope="col">扫描上限</th>
            <th scope="col" class="actions-column">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in rows"
            :key="index"
            :data-twitter-subscription-index="isHashtag ? undefined : index"
            :data-twitter-hashtag-index="isHashtag ? index : undefined"
          >
            <td class="identity-cell">
              <el-input
                :model-value="isHashtag ? row.hashtag : row.username"
                :disabled="disabled"
                :placeholder="isHashtag ? '#AI' : 'username'"
                :aria-label="isHashtag ? '话题标签' : '用户名'"
                @update:model-value="updateRow(index, isHashtag ? 'hashtag' : 'username', $event)"
              />
            </td>
            <td class="groups-cell">
              <el-button text :disabled="disabled" aria-label="编辑推送群" @click="openGroups(index)">
                {{ groupSummary(row.groupIds) }}
              </el-button>
            </td>
            <td class="checkbox-cell">
              <el-checkbox
                :model-value="row.excludeRetweets ?? true"
                :disabled="disabled"
                @update:model-value="updateRow(index, 'excludeRetweets', $event)"
              />
            </td>
            <td v-if="isHashtag" class="checkbox-cell">
              <el-checkbox
                :model-value="row.excludeReplies ?? true"
                :disabled="disabled"
                @update:model-value="updateRow(index, 'excludeReplies', $event)"
              />
            </td>
            <td class="filter-cell">
              <el-select
                :model-value="row.tweetFilterMode ?? 'all'"
                :disabled="disabled"
                @update:model-value="updateRow(index, 'tweetFilterMode', $event)"
              >
                <el-option label="全部" value="all" />
                <el-option label="仅含媒体" value="mediaOnly" />
                <el-option label="仅纯文字" value="textOnly" />
              </el-select>
            </td>
            <td v-if="isHashtag" class="limit-cell">
              <el-input-number
                :model-value="row.maxPostsPerCheck ?? 50"
                :disabled="disabled"
                :min="10"
                :max="200"
                :step="10"
                controls-position="right"
                @update:model-value="updateRow(index, 'maxPostsPerCheck', $event)"
              />
            </td>
            <td class="actions-cell">
              <el-tooltip content="上移" placement="top">
                <el-button text circle aria-label="上移订阅" :disabled="disabled || index === 0" @click="moveRow(index, -1)">
                  <IconArrowUp />
                </el-button>
              </el-tooltip>
              <el-tooltip content="下移" placement="top">
                <el-button text circle aria-label="下移订阅" :disabled="disabled || index === rows.length - 1" @click="moveRow(index, 1)">
                  <IconArrowDown />
                </el-button>
              </el-tooltip>
              <el-tooltip content="删除" placement="top">
                <el-button text circle aria-label="删除订阅" :disabled="disabled" @click="removeRow(index)">
                  <IconDelete />
                </el-button>
              </el-tooltip>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <el-dialog
      v-model="groupDialogVisible"
      title="编辑推送群"
      width="min(520px, 92vw)"
      append-to-body
      destroy-on-close
    >
      <div class="group-editor">
        <div v-for="(_, index) in groupDraft" :key="index" class="group-editor-row">
          <el-input v-model="groupDraft[index]" :aria-label="`推送群 ${index + 1}`" placeholder="群号 / 频道号" />
          <el-tooltip content="删除" placement="top">
            <el-button text circle aria-label="删除推送群" @click="removeGroup(index)">
              <IconDelete />
            </el-button>
          </el-tooltip>
        </div>
        <el-button plain @click="addGroup">
          <IconAdd />
          <span>添加群</span>
        </el-button>
      </div>
      <template #footer>
        <el-button @click="groupDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveGroups">确定</el-button>
      </template>
    </el-dialog>
  </SchemaBase>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PropType } from 'vue'
import { IconAdd, IconArrowDown, IconArrowUp, IconDelete, SchemaBase } from '@koishijs/client'
import type { Schema } from '@koishijs/client'

defineOptions({ inheritAttrs: false })

interface SubscriptionRow {
  username?: string
  hashtag?: string
  groupIds?: string[]
  excludeRetweets?: boolean
  excludeReplies?: boolean
  tweetFilterMode?: 'all' | 'mediaOnly' | 'textOnly'
  maxPostsPerCheck?: number
}

const props = defineProps({
  schema: {} as PropType<Schema>,
  modelValue: {} as PropType<SubscriptionRow[]>,
  disabled: Boolean,
  prefix: String,
  initial: {} as PropType<SubscriptionRow[]>,
  extra: {} as PropType<any>,
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: SubscriptionRow[]): void
}>()

const rows = computed(() => Array.isArray(props.modelValue) ? props.modelValue : [])
const isHashtag = computed(() => props.schema?.meta.role === 'twitter-hashtag-subscriptions')
const groupDialogVisible = ref(false)
const groupRowIndex = ref(-1)
const groupDraft = ref<string[]>([])

function emitRows(value: SubscriptionRow[]) {
  emit('update:modelValue', value)
}

function updateRow(index: number, key: keyof SubscriptionRow, value: any) {
  const next = rows.value.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row)
  emitRows(next)
}

function addRow() {
  const row: SubscriptionRow = isHashtag.value
    ? { hashtag: '', groupIds: [], excludeRetweets: true, excludeReplies: true, tweetFilterMode: 'all', maxPostsPerCheck: 50 }
    : { username: '', groupIds: [], excludeRetweets: true, tweetFilterMode: 'all' }
  emitRows([...rows.value, row])
}

function removeRow(index: number) {
  emitRows(rows.value.filter((_, rowIndex) => rowIndex !== index))
}

function moveRow(index: number, offset: number) {
  const target = index + offset
  if (target < 0 || target >= rows.value.length) return
  const next = rows.value.slice()
  ;[next[index], next[target]] = [next[target], next[index]]
  emitRows(next)
}

function groupSummary(groupIds?: string[]) {
  const groups = normalizeGroups(groupIds || [])
  if (!groups.length) return '添加群'
  if (groups.length === 1) return groups[0]
  return `${groups[0]} 等 ${groups.length} 个群`
}

function normalizeGroups(values: string[]) {
  return [...new Set(values.map(value => String(value).trim()).filter(Boolean))]
}

function openGroups(index: number) {
  groupRowIndex.value = index
  const groups = Array.isArray(rows.value[index]?.groupIds) ? rows.value[index].groupIds : []
  groupDraft.value = groups.length ? groups.map(value => String(value)) : ['']
  groupDialogVisible.value = true
}

function addGroup() {
  groupDraft.value.push('')
}

function removeGroup(index: number) {
  groupDraft.value.splice(index, 1)
  if (!groupDraft.value.length) groupDraft.value.push('')
}

function saveGroups() {
  if (groupRowIndex.value >= 0) {
    updateRow(groupRowIndex.value, 'groupIds', normalizeGroups(groupDraft.value))
  }
  groupDialogVisible.value = false
}
</script>

<style lang="scss">
.twitter-subscription-table-wrap {
  width: 100%;
  overflow-x: auto;
  padding: 0.5rem 1rem 1rem;
  box-sizing: border-box;
}

.twitter-subscription-table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
  table-layout: fixed;

  th,
  td {
    border: 1px solid var(--el-border-color);
  }

  th {
    padding: 0.55rem 0.65rem;
    color: var(--k-text-normal);
    font-size: 13px;
    font-weight: 600;
    line-height: 1.25rem;
    text-align: center;
    white-space: nowrap;
  }

  td {
    height: 40px;
    padding: 0;
    background: var(--k-card-bg);
  }

  .identity-cell {
    width: 20%;
  }

  .groups-cell {
    width: 20%;
    text-align: center;

    .el-button {
      width: 100%;
      min-width: 0;
      padding: 0 10px;
    }

    .el-button > span {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .checkbox-cell {
    width: 88px;
    text-align: center;
  }

  .filter-cell {
    width: 120px;
  }

  .limit-cell {
    width: 112px;
  }

  .actions-column,
  .actions-cell {
    width: 112px;
    text-align: center;
  }

  .actions-cell {
    white-space: nowrap;

    .el-button + .el-button {
      margin-left: 0;
    }

    .k-icon {
      width: 15px;
      height: 15px;
    }
  }

  .el-input__wrapper,
  .el-select__wrapper {
    min-height: 40px;
    border-radius: 0;
    box-shadow: none !important;
  }

  .el-input-number {
    width: 100%;
  }
}

.group-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.group-editor-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 36px;
  gap: 8px;
  align-items: center;

  .k-icon {
    width: 15px;
    height: 15px;
  }
}
</style>
