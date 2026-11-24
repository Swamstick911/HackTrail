import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    signal,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const result = await response.json();
  if (!response.ok)
    throw new ApiError(
      result.error ?? result.message ?? 'The request could not be completed.',
      response.status,
    );
  return result as T;
}
export function useResource<T>(path: string | null, pollMs = 0) {
  const [state, setState] = useState<{ path: string | null; data?: T; error?: Error }>({ path });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!path) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    async function load() {
      try {
        const data = await api<T>(path!, undefined, 'GET', controller.signal);
        if (!controller.signal.aborted) setState({ path, data });
      } catch (error) {
        if (!controller.signal.aborted)
          setState((previous) => ({
            path,
            data: previous.path === path ? previous.data : undefined,
            error: error instanceof Error ? error : new Error('Could not load this page.'),
          }));
      }
      if (pollMs && !controller.signal.aborted)
        timer = setTimeout(() => {
          if (document.visibilityState === 'visible') void load();
          else timer = setTimeout(() => void load(), pollMs);
        }, pollMs);
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [path, pollMs, revision]);
  const current = state.path === path ? state : { path };
  return { ...current, loading: Boolean(path && !current.data && !current.error), refresh };
}
export function useAction() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  async function run(operation: () => Promise<unknown>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Something went wrong. Please try again.');
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return { run, error, busy, clearError: () => setError('') };
}
export function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
