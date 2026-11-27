import { registerEraSchema } from '@util/era';
import { Schema } from '../../schema';

// 把变量结构注册到 ERA. registerEraSchema 会等待 ERA 加载、在 ERA 重载后重新注册, 并在脚本卸载时注销.
$(() => {
  errorCatched(registerEraSchema)(Schema);
});
