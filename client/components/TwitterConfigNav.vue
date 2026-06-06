<template>
  <div
    data-twitter-fetcher-nav="1"
    :class="[$style.container, collapsed ? $style.collapsed : '']"
    :style="containerPosition"
  >
    <div :class="$style.header" @mousedown="startMove" @touchstart="startMove">
      <span :class="$style.handle">::</span>
      <button :class="$style.toggle" type="button" @click.stop="collapsed = !collapsed" @mousedown.stop @touchstart.stop>
        v
      </button>
    </div>
    <div :class="$style.body">
      <div :class="$style.section">
        <div :class="$style.sectionTitle">配置</div>
        <div
          v-for="item in staticItems"
          :key="item.id"
          :class="[$style.item, activeItem === item.id ? $style.active : '']"
          @click="toSchema(item.id, item.keys)"
        >
          {{ item.label }}
        </div>
      </div>
      <div v-if="subscriptionItems.length" :class="$style.section">
        <div :class="$style.sectionTitle">订阅</div>
        <div
          v-for="item in subscriptionItems"
          :key="item.id"
          :class="[$style.item, activeItem === `sub-${item.id}` ? $style.active : '']"
          @click="toSubscription(item.id)"
        >
          {{ item.label }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onUnmounted, reactive, ref, watch } from 'vue'
import type { ComputedRef } from 'vue'

interface SubscriptionConfig {
  username?: string
}

interface TwitterFetcherConfig {
  subscriptions?: SubscriptionConfig[]
}

const current = inject<ComputedRef<{ config: TwitterFetcherConfig }>>('manager.settings.current')
const collapsed = ref(false)
const activeItem = ref('')

const staticItems = [
  { id: 'parse', label: '解析设置', keys: ['showScreenshot', 'sendText', 'silentParsing'] },
  { id: 'subscription-content', label: '订阅推送内容', keys: ['sub_showLink', 'sub_sendText', 'sub_sendMedia'] },
  { id: 'translation', label: '翻译设置', keys: ['parse_enableTranslation', 'sub_enableTranslation'] },
  { id: 'fetch', label: '获取方式设置', keys: ['tweetFetchMode', 'mediaFetchMode'] },
  { id: 'files', label: '文件发送设置', keys: ['separateMediaSend', 'imageTransferMode', 'videoTransferMode', 'gifMode'] },
  { id: 'subscription', label: '订阅设置', keys: ['enableSubscription', 'platform', 'subscriptions'] },
  { id: 'debug', label: '调试设置', keys: ['logDetails'] },
]

const subscriptionItems = computed(() => {
  const list = current?.value?.config?.subscriptions ?? []
  return list.map((item, index) => {
    const username = item?.username?.trim()
    return {
      id: String(index),
      label: username || `订阅 ${index + 1}`,
      username,
    }
  })
})

const mouseInfo = reactive({
  ing: false,
  top: 100,
  right: 20,
  startTop: 0,
  startRight: 0,
  startX: 0,
  startY: 0,
  width: 0,
  height: 0,
})

const containerPosition = computed(() => ({
  top: `${mouseInfo.top}px`,
  right: `${mouseInfo.right}px`,
}))

function getText(node: Element) {
  const element = node as HTMLElement
  return `${element.innerHTML}\n${element.textContent || ''}`
}

function findSchemaNode(test: (text: string) => boolean) {
  const nodes = document.querySelectorAll('.k-schema-left')
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (test(getText(node))) return node as HTMLElement
  }
}

function toSchema(id: string, keys: string[]) {
  const node = findSchemaNode((text) => keys.some((key) => text.includes(key)))
  if (!node) return
  node.scrollIntoView({ block: 'center' })
  activeItem.value = id
}

function toSubscription(index: string) {
  const keys = [`subscriptions.${index}.username`, `subscriptions[${index}].username`]
  const username = subscriptionItems.value[Number(index)]?.username
  const node = findSchemaNode((text) => keys.some((key) => text.includes(key)) || (!!username && text.includes(username)))
  if (!node) return
  node.scrollIntoView({ block: 'center' })
  activeItem.value = `sub-${index}`
}

function getPointer(ev: MouseEvent | TouchEvent) {
  return ev instanceof TouchEvent ? ev.touches[0] as unknown as MouseEvent : ev
}

function startMove(ev: MouseEvent | TouchEvent) {
  const e = getPointer(ev)
  const rect = (e.target as HTMLElement).closest('[data-twitter-fetcher-nav="1"]')?.getBoundingClientRect()
  if (rect) {
    mouseInfo.width = rect.width
    mouseInfo.height = rect.height
  }
  mouseInfo.startTop = mouseInfo.top
  mouseInfo.startRight = mouseInfo.right
  mouseInfo.startX = e.clientX
  mouseInfo.startY = e.clientY
  mouseInfo.ing = true
}

function onMousemove(ev: MouseEvent | TouchEvent) {
  if (!mouseInfo.ing) return
  const e = getPointer(ev)
  let top = mouseInfo.startTop + (e.clientY - mouseInfo.startY)
  let right = mouseInfo.startRight - (e.clientX - mouseInfo.startX)
  const boundary = document.querySelector('.plugin-view')?.getBoundingClientRect()
  let minTop = 0
  let maxTop = window.innerHeight - mouseInfo.height
  let minRight = 0
  let maxRight = window.innerWidth - mouseInfo.width
  if (boundary) {
    minTop = boundary.top
    maxTop = boundary.bottom - mouseInfo.height
    minRight = window.innerWidth - boundary.right
    maxRight = window.innerWidth - boundary.left - mouseInfo.width
  }
  mouseInfo.top = Math.max(minTop, Math.min(maxTop, top))
  mouseInfo.right = Math.max(minRight, Math.min(maxRight, right))
}

function endMove() {
  mouseInfo.ing = false
}

let observer: IntersectionObserver | null = null
const observed = new Map<Element, string>()

function initObserver() {
  observer?.disconnect()
  observed.clear()
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const id = observed.get(entry.target)
        if (id) activeItem.value = id
      }
    }
  }, { rootMargin: '-40% 0px -40% 0px', threshold: 0 })

  for (const item of staticItems) {
    const node = findSchemaNode((text) => item.keys.some((key) => text.includes(key)))
    if (node) {
      observed.set(node, item.id)
      observer.observe(node)
    }
  }
}

window.addEventListener('mousemove', onMousemove)
window.addEventListener('mouseup', endMove)
window.addEventListener('touchmove', onMousemove)
window.addEventListener('touchend', endMove)

watch(() => current?.value?.config, () => setTimeout(initObserver, 800), { immediate: true, deep: true })

onUnmounted(() => {
  window.removeEventListener('mousemove', onMousemove)
  window.removeEventListener('mouseup', endMove)
  window.removeEventListener('touchmove', onMousemove)
  window.removeEventListener('touchend', endMove)
  observer?.disconnect()
})
</script>

<style module lang="scss">
.container {
  position: absolute;
  z-index: 1000;
  width: 200px;
  max-width: 90vw;
  max-height: 70vh;
  background: var(--k-card-bg);
  border: 1px solid var(--k-card-border);
  border-radius: 8px;
  box-shadow: var(--k-card-shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  user-select: none;
}

.header {
  height: 30px;
  padding: 0 8px;
  border-bottom: 1px solid var(--k-color-divider, #ebeef5);
  background: var(--k-hover-bg);
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: move;
}

.handle {
  color: var(--k-text-light);
  font-weight: 700;
  line-height: 1;
}

.toggle {
  border: 0;
  background: transparent;
  color: var(--k-text-light);
  cursor: pointer;
  font-size: 14px;
  transition: transform 0.2s ease;
}

.body {
  overflow-y: auto;
  padding: 4px 0;
}

.collapsed {
  max-height: 30px;

  .body {
    display: none;
  }

  .toggle {
    transform: rotate(-90deg);
  }
}

.section {
  margin-bottom: 4px;
}

.sectionTitle {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--k-text-light);
  background: var(--k-bg-light);
}

.item {
  padding: 8px 14px;
  border-left: 3px solid transparent;
  color: var(--k-text-normal);
  cursor: pointer;
  font-size: 13px;
  word-break: break-word;

  &:hover {
    background: var(--k-hover-bg);
    color: var(--k-text-active);
  }
}

.active {
  color: var(--k-color-primary);
  background: var(--k-activity-bg);
  border-left-color: var(--k-color-primary);
  font-weight: 500;
}
</style>
