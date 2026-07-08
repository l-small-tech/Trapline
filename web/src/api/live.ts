/**
 * EventSource wrapper for the /live SSE stream with typed event routing.
 * EventSource reconnects automatically; we surface connection state so the
 * UI can show "live" vs "reconnecting".
 */
import { API } from './client';
import type { SseMessage } from '../../../shared/types';

export type LiveListener = (msg: SseMessage) => void;

export class LiveConnection {
  private es: EventSource | null = null;
  private listeners = new Set<LiveListener>();
  private stateListeners = new Set<(connected: boolean) => void>();
  connected = false;

  start(): void {
    if (this.es) return;
    const es = new EventSource(`${API}/live`);
    this.es = es;
    const types: SseMessage['type'][] = ['samples', 'event', 'status', 'speedtest', 'suggestion'];
    for (const type of types) {
      es.addEventListener(type, (ev) => {
        const data = JSON.parse((ev as MessageEvent).data) as never;
        this.emit({ type, data } as SseMessage);
      });
    }
    es.onopen = () => this.setConnected(true);
    es.onerror = () => this.setConnected(false);
  }

  stop(): void {
    this.es?.close();
    this.es = null;
    this.setConnected(false);
  }

  private setConnected(v: boolean): void {
    if (this.connected === v) return;
    this.connected = v;
    for (const l of this.stateListeners) l(v);
  }

  private emit(msg: SseMessage): void {
    for (const l of this.listeners) l(msg);
  }

  subscribe(l: LiveListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onState(l: (connected: boolean) => void): () => void {
    this.stateListeners.add(l);
    return () => this.stateListeners.delete(l);
  }
}

/** Singleton shared across the app. */
export const live = new LiveConnection();
