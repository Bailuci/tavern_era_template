import { defineEraDataStore } from '@util/era';
import { Schema } from '../../schema';

/**
 * ERA 的变量是聊天级的: 无论状态栏在哪一楼, 读到的都是最新变量.
 * `data` 是经过 schema 校验的只读数据; 写入请用 `Era.commit`, 见 App.vue.
 */
export const useDataStore = defineEraDataStore(Schema);
