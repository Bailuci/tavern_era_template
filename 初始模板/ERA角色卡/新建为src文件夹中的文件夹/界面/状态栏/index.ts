import App from './App.vue';
import './global.css';

// 不需要等待 ERA: store 会在 ERA 加载后自动取得变量, 之后随 era:writeDone 更新
$(() => {
  createApp(App).use(createPinia()).mount('#app');
});
