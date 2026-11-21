import * as THREE from 'three';
import type { Asset, CameraParameters } from './scene';

const DURATION = 6000;
export const HOME = { x: 0, y: 0, zoom: 0 };
export type Pose = typeof HOME;

export function sweep(progress: number): Pose {
  const angle = Math.PI * 2 * progress;
  return { x: Math.sin(angle) * 0.045, y: Math.sin(angle) * 0.012, zoom: (1 - Math.cos(angle)) * 0.025 };
}

export function cameraFor(aspect: number, fov: number) {
  return new THREE.PerspectiveCamera(fov, aspect, 0.1, 12);
}

export function positionCamera(camera: THREE.PerspectiveCamera, pose: Pose) {
  const x = pose.x * Math.min(camera.aspect, 1);
  camera.position.set(x, pose.y, -pose.zoom);
  camera.lookAt(x * 0.65, pose.y * 0.65, -3.2);
}

// Smooth depth across a few grid samples so thin structures remain connected
// during the sweep. Preserve their high-resolution color in the original texture.
function smoothDepth(data: DataView, width: number, height: number) {
  let values = Float32Array.from({ length: width * height }, (_, i) => data.getUint16(i * 2, true) / 65535);
  for (let pass = 0; pass < 3; pass++) {
    const filtered = new Float32Array(values.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const left = x > 0 ? i - 1 : i;
        const right = x + 1 < width ? i + 1 : i;
        const up = y > 0 ? i - width : i;
        const down = y + 1 < height ? i + width : i;
        filtered[i] = (4 * values[i] + values[left] + values[right] + values[up] + values[down]) / 8;
      }
    }
    values = filtered;
  }
  return values;
}

export async function loadWorld(image: Asset, depth: Asset & { version: number }, camera: CameraParameters, signal: AbortSignal) {
  const response = await fetch(depth.url, { signal });
  if (!response.ok) throw new Error('Could not load scene depth.');
  const data = new DataView(await response.arrayBuffer());
  const { width, height } = depth;
  if (depth.version !== 1 || width < 2 || height < 2 || data.byteLength !== width * height * 2) {
    throw new Error('Unexpected scene depth format.');
  }

  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(width * height * 3);
  const uv = new Float32Array(width * height * 2);
  const depths = smoothDepth(data, width, height);
  const indices: number[] = [];
  const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const aspect = image.width / image.height;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const index = row * width + col;
      const u = col / (width - 1);
      const v = row / (height - 1);
      const z = camera.nearDepth + (camera.farDepth - camera.nearDepth) * depths[index];
      positions.set([(2 * u - 1) * z * halfHeight * aspect, (1 - 2 * v) * z * halfHeight, -z], index * 3);
      uv.set([u, 1 - v], index * 2);
    }
  }

  for (let row = 0; row < height - 1; row++) {
    for (let col = 0; col < width - 1; col++) {
      const a = row * width + col;
      indices.push(a, a + width, a + 1);
      indices.push(a + 1, a + width, a + width + 1);
    }
  }

  const texture = await new THREE.TextureLoader().loadAsync(image.url);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const backingWidth = 2 * 4.8 * halfHeight;
  const backing = new THREE.PlaneGeometry(backingWidth * aspect * 1.08, backingWidth * 1.08);
  // A slight overscan keeps newly exposed edges covered. Keep the original UV scale at the reference pose.
  const backingUv = backing.getAttribute('uv');
  for (let i = 0; i < backingUv.count; i++) {
    backingUv.setXY(i, 0.5 + 1.08 * (backingUv.getX(i) - 0.5), 0.5 + 1.08 * (backingUv.getY(i) - 0.5));
  }
  const fill = new THREE.Mesh(backing, material);
  fill.position.z = -4.8;

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  const world = new THREE.Scene();
  world.add(fill, new THREE.Mesh(geometry, material));
  return {
    world,
    dispose() {
      geometry.dispose();
      backing.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}

export function canExportVideo() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

export async function encodeSweep(world: THREE.Scene, image: Asset, params: CameraParameters, signal: AbortSignal) {
  const scale = Math.min(1, 720 / Math.min(image.width, image.height), 1280 / Math.max(image.width, image.height));
  const width = Math.min(image.width, Math.max(2, Math.round(image.width * scale / 2) * 2));
  const height = Math.min(image.height, Math.max(2, Math.round(image.height * scale / 2) * 2));
  const camera = cameraFor(image.width / image.height, params.fov);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  try {
    renderer.setSize(width, height, false);
    return await encodeCanvas(renderer.domElement, DURATION, signal, progress => {
      positionCamera(camera, sweep(progress));
      renderer.render(world, camera);
    });
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

export async function encodeCanvas(canvas: HTMLCanvasElement, duration: number, signal: AbortSignal,
                                   draw: (progress: number) => void) {
  const { BufferTarget, CanvasSource, Output, WebMOutputFormat, canEncodeVideo } = await import('mediabunny');
  const frameRate = 30;
  const frameCount = duration / 1000 * frameRate;
  const bitrate = 3_000_000;
  if (!await canEncodeVideo('vp8', { width: canvas.width, height: canvas.height, bitrate })) {
    throw new Error('This browser does not have a compatible WebM encoder.');
  }
  const target = new BufferTarget();
  const output = new Output({ format: new WebMOutputFormat(), target });
  try {
    const source = new CanvasSource(canvas, { codec: 'vp8', bitrate });
    output.addVideoTrack(source, { frameRate });
    await output.start();

    for (let frame = 0; frame < frameCount; frame++) {
      signal.throwIfAborted();
      draw(frame / (frameCount - 1));
      await source.add(frame / frameRate, 1 / frameRate);
      if (frame % 10 === 0) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }

    await output.finalize();
    if (!target.buffer) throw new Error('The browser could not finish the WebM file.');
    return new Blob([target.buffer], { type: 'video/webm' });
  } catch (error) {
    await output.cancel();
    throw error;
  }
}

export const sweepDuration = DURATION;
