<template>
  <div class="status-bar">
    <template v-if="data">
      <div class="row">
        <span>{{ data.世界.时间段 }}</span>
        <span>{{ data.世界.地点 }}</span>
      </div>
      <div class="row">
        <span>好感度 {{ data.角色.好感度 }}</span>
        <span>心情 {{ data.角色.心情 }}</span>
      </div>
      <div v-if="items.length > 0" class="row">
        <span v-for="[name, item] in items" :key="name">{{ name }} ×{{ item.数量 }}</span>
      </div>
      <button type="button" :disabled="busy" @click="giveFlower">送一朵花（好感度 +5）</button>
      <div v-if="message" class="hint">{{ message }}</div>
    </template>
    <div v-else-if="error" class="hint">变量不符合变量结构: {{ error }}</div>
    <div v-else class="hint">等待 ERA 变量……</div>
  </div>
</template>

<script setup lang="ts">
import { useDataStore } from './store';

const store = useDataStore();
const { data, error } = storeToRefs(store);
const items = computed(() => Object.entries(data.value?.角色.背包 ?? {}));

const busy = ref(false);
const message = ref('');

/** 写入变量的示例: 等待 ERA 计算完成; atomic 表示有任何一项不能生效 (例如被变量结构拒绝) 就全部不写入 */
async function giveFlower() {
  busy.value = true;
  message.value = '';
  try {
    await Era.commit([{ edit: { 角色: { 好感度: '+=5' } } }], { atomic: true });
  } catch (e) {
    message.value = `没有写入: ${(e as Error).message}`;
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.status-bar {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px;
  border: 1px solid #ccc;
  border-radius: 8px;
  font-size: 14px;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.hint {
  color: #888;
}
</style>
