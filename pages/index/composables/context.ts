import { inject, provide, type InjectionKey } from 'vue'
import type { usePairApp } from './usePairApp'

type PairApp = ReturnType<typeof usePairApp>
const pairAppKey: InjectionKey<PairApp> = Symbol('pair-app')

export function providePairContext(app: PairApp) {
  provide(pairAppKey, app)
}

export function usePairContext(): PairApp {
  const app = inject(pairAppKey)
  if (!app) throw new Error('Pair app context is unavailable')
  return app
}
