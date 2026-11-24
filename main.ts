import App from './App.uvue'

import { createSSRApp } from 'vue'
/** 创建并返回应用入口实例。 */
export const createApp = () => {
	// 挂载根组件的 Vue 应用实例。
	const app = createSSRApp(App)
	return {
		app
	}
}
