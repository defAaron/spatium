export type Stage = 'uploading' | 'stylizing' | 'estimating_depth' | 'ready' | 'needs_key' | 'still_ready' | 'failed';

export interface Asset {
  url: string;
  width: number;
  height: number;
}

export interface CameraParameters {
  fov: number;
  nearDepth: number;
  farDepth: number;
}

export interface Scene {
  walkthrough?: Walkthrough;
  camera?: CameraParameters;
  id: string;
  stage: Stage;
  credits: number | null;
  error: string | null;
  image?: Asset;
  depth?: Asset & { version: 1 };
}

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(typeof payload?.detail === 'string' ? payload.detail : 'The server could not complete the request.');
  }
  return response.json();
}

export interface Walkthrough {
  count: number;
  stops: {label: string; url: string}[];
}
