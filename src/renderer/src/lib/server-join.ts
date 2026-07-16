import { useServersStore } from '@/stores/servers.store'

export function waitForJoinedServer(serverId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let unsubscribe = (): void => {}
    let timer: ReturnType<typeof setTimeout>
    const finish = (error?: string): void => {
      clearTimeout(timer)
      unsubscribe()
      if (error) reject(new Error(error))
      else resolve()
    }
    const inspect = (): void => {
      const state = useServersStore.getState()
      if (state.servers.some((server) => server.id === serverId)) {
        finish()
      } else if (state.pendingJoin !== serverId && state.lastError) {
        finish(state.lastError)
      }
    }
    unsubscribe = useServersStore.subscribe(inspect)
    timer = setTimeout(() => finish('Join timed out. The server may be offline or unreachable.'), 16_500)
    inspect()
  })
}
