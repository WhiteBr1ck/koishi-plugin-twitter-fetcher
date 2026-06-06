<template>
  <TwitterConfigNav v-if="isOwn" />
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import type { ComputedRef } from 'vue'
import TwitterConfigNav from './components/TwitterConfigNav.vue'

const pluginName = inject<ComputedRef<string>>('plugin:name')
const isOwn = computed(() => pluginName?.value === 'koishi-plugin-twitter-fetcher')
</script>
