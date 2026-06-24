// Thin WebSocket client for the multiplayer race protocol (backend src/realtime/wsHandlers.js).
// Every frame is JSON { type, ...fields }. Requests carry a reqId and resolve when the matching
// `ack` arrives; server-pushed events are delivered to `on(type)` subscribers.

export type Frame = Record<string, unknown> & { type: string }
type Handler = (msg: Frame) => void

// Production build uses .env.production (Render); `npm run dev` uses .env.development (localhost).
// This hardcoded fallback points at the deployed server in case a build runs without an env file.
const DEFAULT_URL =
  (import.meta.env.VITE_RACE_WS_URL as string | undefined) || 'wss://arrow-puzzle-backend.onrender.com'

export class RaceSocket {
  private ws: WebSocket | null = null
  private url: string
  private reqId = 0
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  private handlers = new Map<string, Set<Handler>>()

  constructor(url: string = DEFAULT_URL) {
    this.url = url
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url)
      } catch (e) {
        reject(e as Error)
        return
      }
      this.ws.onopen = () => resolve()
      this.ws.onerror = () => reject(new Error('Could not connect to the race server'))
      this.ws.onclose = () => this.#emit({ type: '__close' })
      this.ws.onmessage = (ev) => {
        let msg: Frame
        try { msg = JSON.parse(ev.data as string) } catch { return }
        if (msg.type === 'ack') {
          const p = this.pending.get(msg.reqId as number)
          if (p) {
            this.pending.delete(msg.reqId as number)
            const payload = (msg.payload as any) || {}
            if (payload.error) p.reject(new Error(payload.error))
            else p.resolve(payload)
          }
          return
        }
        this.#emit(msg)
      }
    })
  }

  // Request with an ack. Resolves with the ack payload, rejects on { error }.
  request<T = any>(type: string, fields: Record<string, unknown> = {}): Promise<T> {
    const reqId = ++this.reqId
    return new Promise<T>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { reject(new Error('Not connected')); return }
      this.pending.set(reqId, { resolve, reject })
      this.ws.send(JSON.stringify({ type, reqId, ...fields }))
    })
  }

  // Fire-and-forget (no ack): race:progress, room:leave.
  send(type: string, fields: Record<string, unknown> = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, ...fields }))
    }
  }

  // Subscribe to a server event type ('room:update', 'race:start', …, or '__close'). Returns an unsubscribe.
  on(type: string, h: Handler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type)!.add(h)
    return () => this.handlers.get(type)?.delete(h)
  }

  close() { try { this.ws?.close() } catch { /* ignore */ } }

  #emit(msg: Frame) {
    const set = this.handlers.get(msg.type)
    if (set) for (const h of [...set]) h(msg)
  }
}
