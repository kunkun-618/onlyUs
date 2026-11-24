import { inject, provide, type InjectionKey } from 'vue'
import type { usePairApp } from './usePairApp'

// 页面共享上下文的完整状态与操作类型。
type PairApp = ReturnType<typeof usePairApp>
// 提供与注入页面上下文时使用的唯一标识。
const pairAppKey: InjectionKey<PairApp> = Symbol('pair-app')

/** 将 app 中的页面状态与操作提供给后代组件。 */
export const providePairContext = (app: PairApp) => {
  provide(pairAppKey, app)
}

/** 获取页面共享上下文，缺少提供者时抛出错误。 */
export const usePairContext = (): PairApp => {
  // 当前组件从祖先节点取得的页面上下文。
  const app = inject(pairAppKey)
  if (!app) throw new Error('Pair app context is unavailable')
  return app
}
