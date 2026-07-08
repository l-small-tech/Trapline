import { useEffect, useState } from 'react';
import type { SseMessage, StatusSnapshot } from '../../../shared/types';
import { api } from '../api/client';
import { live } from '../api/live';

/** Subscribe to a specific SSE message type. */
export function useLiveMessage<T extends SseMessage['type']>(
  type: T,
  handler: (data: Extract<SseMessage, { type: T }>['data']) => void,
): void {
  useEffect(() => {
    live.start();
    return live.subscribe((msg) => {
      if (msg.type === type) (handler as (d: unknown) => void)(msg.data);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, handler]);
}

/** Live status snapshot: initial fetch + SSE updates. */
export function useStatus(): { status: StatusSnapshot | null; connected: boolean } {
  const [status, setStatus] = useState<StatusSnapshot | null>(null);
  const [connected, setConnected] = useState(live.connected);

  useEffect(() => {
    live.start();
    void api.status().then(setStatus).catch(() => {});
    const un1 = live.subscribe((msg) => {
      if (msg.type === 'status') setStatus(msg.data);
    });
    const un2 = live.onState(setConnected);
    return () => {
      un1();
      un2();
    };
  }, []);

  return { status, connected };
}
