export type Stage = 'uploading' | 'stylizing' | 'ready' | 'needs_key' | 'failed';

export interface Walkthrough {
  count: number;
  stops: {label: string; url: string}[];
}

export interface Scene {
  id: string;
  stage: Stage;
  credits: number | null;
  error: string | null;
  walkthrough: Walkthrough;
}

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(typeof payload?.detail === 'string' ? payload.detail : 'The server could not complete the request.');
  }
  return response.json();
}
