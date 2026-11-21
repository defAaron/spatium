import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Scene } from './scene';
import { cameraFor, canExportVideo, encodeSweep, HOME, loadWorld, positionCamera, sweep, sweepDuration } from './viewport';

export function Viewer({ scene }: { scene: Scene }) {
  const mount = useRef<HTMLDivElement>(null);
  const world = useRef<THREE.Scene | null>(null);
  const pose = useRef({ ...HOME });
  const playStart = useRef(0);
  const elapsed = useRef(0);
  const abortExport = useRef<AbortController | null>(null);
  const rotation = useRef<{ x: number; y: number } | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef(0);
  const needsRender = useRef(true);
  const [mode, setMode] = useState<'loading' | 'still' | 'interactive'>(scene.depth ? 'loading' : 'still');
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const { image, depth, camera: params } = scene;
  function report(event: 'interactive' | 'render-failure' | 'export') {
    if (scene.id !== 'demo') {
      void fetch(`/api/scenes/${scene.id}/events/${event}`, {method: 'POST', keepalive: true}).catch(() => {});
    }
  }
  const exportAvailable = canExportVideo();

  useEffect(() => {
    const element = mount.current;
    if (!image || !depth || !params || !element) return;
    const lifetime = new AbortController();
    let renderer: THREE.WebGLRenderer | undefined;
    let content: Awaited<ReturnType<typeof loadWorld>> | undefined;
    let animation = 0;
    let observer: ResizeObserver | undefined;
    const camera = cameraFor(image.width / image.height, params.fov);

    function render(now: number) {
      if (!renderer || !content) return;
      if (playStart.current) {
        elapsed.current = now - playStart.current;
        const progress = Math.min(1, elapsed.current / sweepDuration);
        pose.current = sweep(progress);
        needsRender.current = true;
        if (progress >= 1) {
          playStart.current = 0;
          elapsed.current = 0;
          setPlaying(false);
        }
      }
      if (needsRender.current) {
        positionCamera(camera, pose.current);
        renderer.render(content.world, camera);
        needsRender.current = false;
      }
      animation = requestAnimationFrame(render);
    }

    function resize() {
      if (!element || !renderer) return;
      renderer.setSize(element.clientWidth, element.clientHeight);
      needsRender.current = true;
    }

    function wheel(event: WheelEvent) {
      event.preventDefault();
      move(0, 0, -event.deltaY * 0.001);
    }

    function contextLost(event: Event) {
      event.preventDefault();
      cancelAnimationFrame(animation);
      stopPlayback();
      world.current = null;
      abortExport.current?.abort();
      setExporting(false);
      report('render-failure');
      setMode('still');
      setNotice('3D preview is unavailable. Reload to try the interactive view again.');
    }

    async function start() {
      try {
        content = await loadWorld(image!, depth!, params!, lifetime.signal);
        if (lifetime.signal.aborted) {
          content.dispose();
          return;
        }
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.domElement.addEventListener('webglcontextlost', contextLost);
        renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
        element!.append(renderer.domElement);
        observer = new ResizeObserver(resize);
        observer.observe(element!);
        resize();
        world.current = content.world;
        element!.addEventListener('wheel', wheel, { passive: false });
        animation = requestAnimationFrame(render);
        setMode('interactive');
        report('interactive');
      } catch {
        if (!lifetime.signal.aborted) {
          report('render-failure');
          setMode('still');
          setNotice('3D preview is unavailable on this device.');
        }
      }
    }

    void start();
    return () => {
      lifetime.abort();
      abortExport.current?.abort();
      cancelAnimationFrame(animation);
      observer?.disconnect();
      element.removeEventListener('wheel', wheel);
      renderer?.domElement.removeEventListener('webglcontextlost', contextLost);
      renderer?.domElement.remove();
      renderer?.dispose();
      renderer?.forceContextLoss();
      content?.dispose();
      world.current = null;
    };
  }, [image, depth, params]);

  function stopPlayback() {
    if (playStart.current) {
      playStart.current = 0;
      setPlaying(false);
    }
  }

  function move(x: number, y: number, zoom = 0) {
    stopPlayback();
    elapsed.current = 0;
    const current = pose.current;
    current.x = THREE.MathUtils.clamp(current.x + x, -0.085, 0.085);
    current.y = THREE.MathUtils.clamp(current.y + y, -0.055, 0.055);
    current.zoom = THREE.MathUtils.clamp(current.zoom + zoom, 0, 0.45);
    needsRender.current = true;
  }

  async function download() {
    if (!world.current || !exportAvailable || !image || !params || abortExport.current) return;
    const controller = new AbortController();
    abortExport.current = controller;
    setExporting(true);
    setNotice('');
    try {
      const file = await encodeSweep(world.current, image, params, controller.signal);
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'spatium-miniature.webm';
      link.click();
      report('export');
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (!controller.signal.aborted) {
        setNotice(error instanceof Error ? error.message : 'Export failed. Try again.');
      }
    } finally {
      abortExport.current = null;
      if (!controller.signal.aborted) setExporting(false);
    }
  }

  function pinchDistance() {
    const [first, second] = [...touches.current.values()];
    return first && second ? Math.hypot(first.x - second.x, first.y - second.y) : 0;
  }

  function endPointer(pointerId: number) {
    touches.current.delete(pointerId);
    pinch.current = 0;
    rotation.current = touches.current.values().next().value ?? null;
  }

  if (!image) return null;

  return (
    <section className="viewer" aria-label="Miniature viewer">
      <div
        className={`frame ${mode === 'interactive' ? 'interactive' : ''}`}
        style={{ aspectRatio: image.width / image.height, width: `min(100%, ${72 * image.width / image.height}vh)` }}
        tabIndex={mode === 'interactive' ? 0 : undefined}
        aria-label="Miniature scene. Use arrow keys to move and plus or minus to zoom."
        onKeyDown={(event) => {
          if (mode !== 'interactive') return;
          const actions: Record<string, () => void> = {
            ArrowLeft: () => move(-0.02, 0), ArrowRight: () => move(0.02, 0),
            ArrowUp: () => move(0, 0.02), ArrowDown: () => move(0, -0.02),
            '+': () => move(0, 0, 0.05), '=': () => move(0, 0, 0.05), '-': () => move(0, 0, -0.05),
          };
          if (Object.hasOwn(actions, event.key)) {
            event.preventDefault();
            actions[event.key]();
          }
        }}
        onPointerDown={(event) => {
          if (mode !== 'interactive' || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const position = { x: event.clientX, y: event.clientY };
          touches.current.set(event.pointerId, position);
          rotation.current = position;
          pinch.current = pinchDistance();
        }}
        onPointerMove={(event) => {
          if (!touches.current.has(event.pointerId)) return;
          const position = { x: event.clientX, y: event.clientY };
          touches.current.set(event.pointerId, position);
          const distance = pinchDistance();
          if (distance) {
            if (pinch.current) move(0, 0, (distance - pinch.current) * 0.004);
            pinch.current = distance;
          } else if (rotation.current) {
            move((rotation.current.x - position.x) * 0.001, (position.y - rotation.current.y) * 0.001);
            rotation.current = position;
          }
        }}
        onPointerUp={(event) => endPointer(event.pointerId)}
        onPointerCancel={(event) => endPointer(event.pointerId)}
        onLostPointerCapture={(event) => endPointer(event.pointerId)}
      >
        <img src={image.url} alt={scene.id === 'demo' ? 'Illustrated miniature valley with cabins, pines, and mountains' : 'Stylized miniature'} />
        <div ref={mount} className="canvas" hidden={mode !== 'interactive'} />
      </div>
      {mode === 'interactive' && (
        <div className="viewer-actions">
          <button onClick={() => {
            if (playing) stopPlayback();
            else {
              playStart.current = performance.now() - elapsed.current;
              setPlaying(true);
            }
          }}>{playing ? 'Pause motion' : 'Play motion'}</button>
          <div className="zoom-actions" aria-label="Zoom">
            <button aria-label="Zoom out" onClick={() => move(0, 0, -0.06)}>−</button>
            <button aria-label="Zoom in" onClick={() => move(0, 0, 0.06)}>+</button>
          </div>
          <button onClick={() => {
            stopPlayback();
            elapsed.current = 0;
            pose.current = { ...HOME };
            needsRender.current = true;
          }}>Reset</button>
          <button className="download" disabled={!exportAvailable || exporting} onClick={() => void download()}>
            {exporting ? 'Encoding…' : 'Download WebM'}
          </button>
        </div>
      )}
      {mode === 'interactive' && !exportAvailable && <p className="quiet">Video export requires a browser with WebM encoding support.</p>}
      {notice && <p role="status" className="quiet">{notice}</p>}
    </section>
  );
}
