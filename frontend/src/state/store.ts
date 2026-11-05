/**
 * 极简外部 store：React 侧用 useSyncExternalStore 订阅。
 *
 * 迁移自 Vue 的 reactive/ref：业务状态仍然是「模块级可变对象 + 显式 bump」，
 * 组件在 getVersion 变化时重新渲染，读取的永远是最新值。
 * 这样状态逻辑与原来逐行一致，只是把响应式系统换成了显式通知。
 */
import { useSyncExternalStore } from 'react'

export interface Store {
  subscribe: (listener: () => void) => () => void
  getVersion: () => number
  bump: () => void
}

export function createStore(): Store {
  let version = 0
  const listeners = new Set<() => void>()
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getVersion: () => version,
    bump: () => {
      version += 1
      for (const listener of [...listeners]) listener()
    },
  }
}

/** 订阅一个 store：返回其版本号（仅用于触发重渲染） */
export function useStoreVersion(store: Store): number {
  return useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion)
}
