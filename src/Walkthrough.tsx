import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Walkthrough as Tour } from './scene';
import { canExportVideo, encodeCanvas } from './viewport';
import { filmPose, panoramaRenderer, startPose, tourDuration } from './tour';

export function Walkthrough({tour, id}: {tour: Tour; id: string}) {
  const {stops} = tour;
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pose = useRef({...startPose});
  const textures = useRef<THREE.Texture[]>([]);
  const motion = useRef<{start: number; from: number; to: number; film: boolean} | null>(null);
  const frame = useRef(0);
  const draw = useRef<() => void>(() => {});
  const pointers = useRef(new Map<number, {x: number; y: number}>());
  const recording = useRef<AbortController | null>(null);
  const [stop, setStop] = useState(0);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [heading, setHeading] = useState(0);
  const [message, setMessage] = useState('');
  const elapsed = useRef(0);
  // Polling can replace the manifest object while its committed assets stay identical.
  const urls = JSON.stringify(stops.map(s => s.url));
  useEffect(() => {
    const el = canvas.current!;
    let closed = false;
    let view: ReturnType<typeof panoramaRenderer> | undefined;
    const owned: THREE.Texture[] = [];
    let observer: ResizeObserver | undefined;
    setReady(false);
    setMessage('');
    function lost(event: Event) {
      event.preventDefault();
      recording.current?.abort();
      cancelAnimationFrame(frame.current);
      motion.current = null;
      setPlaying(false);
      setReady(false);
      setMessage('Interactive view unavailable. You can still browse the panoramic stills.');
    }
    function wheel(event: WheelEvent) {
      if (!view) return;
      event.preventDefault();
      zoom(event.deltaY * 0.06);
    }
    el.addEventListener('wheel', wheel, {passive:false});
    el.addEventListener('webglcontextlost', lost);
    async function load() {
      try {
        for (const url of JSON.parse(urls) as string[]) {
          const texture = await new THREE.TextureLoader().loadAsync(url);
          if (closed) { texture.dispose(); return; }
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.wrapS = THREE.RepeatWrapping;
          // Longitude jumps at the seam. Disable mip selection across that discontinuity.
          texture.generateMipmaps = false;
          texture.minFilter = THREE.LinearFilter;
          owned.push(texture);
        }
        textures.current = owned;
        view = panoramaRenderer(el, owned);
        draw.current = () => {
          const anim = motion.current;
          if (anim) {
            const duration = anim.film ? tourDuration : 650;
            const t = Math.min(1, (performance.now() - anim.start) / duration);
            if (anim.film) {
              elapsed.current = t * tourDuration;
              pose.current = filmPose(t, owned.length);
            } else {
              pose.current.at = anim.from + (anim.to - anim.from) * t*t*(3-2*t);
            }
            if (t >= 1) {
              motion.current = null;
              elapsed.current = 0;
              setPlaying(false);
            }
          }
          view!.draw(pose.current);
          setHeading(Math.round(THREE.MathUtils.radToDeg(pose.current.yaw)));
          setStop(Math.round(pose.current.at));
          cancelAnimationFrame(frame.current);
          if (motion.current) frame.current = requestAnimationFrame(draw.current);
        };
        function resize() {
          const scale = Math.min(devicePixelRatio, 1.5);
          view!.resize(Math.max(1, Math.round(el.clientWidth*scale)), Math.max(1, Math.round(el.clientHeight*scale)));
          draw.current();
        }
        observer = new ResizeObserver(resize);
        observer.observe(el);
        resize();
        setReady(true);
        if (id !== 'demo' && owned.length === tour.count) {
          void fetch(`/api/scenes/${id}/events/interactive`, {method:'POST'}).catch(() => {});
        }
      } catch {
        if (!closed) setMessage('Interactive view unavailable. You can still browse the panoramic stills.');
      }
    }
    void load();
    return () => {
      closed = true;
      recording.current?.abort();
      cancelAnimationFrame(frame.current);
      motion.current = null;
      draw.current = () => {};
      pointers.current.clear();
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('webglcontextlost', lost);
      observer?.disconnect();
      view?.dispose();
      owned.forEach(t => t.dispose());
      textures.current = [];
    };
  }, [urls, id, tour.count]);

  function interrupt() {
    motion.current = null;
    elapsed.current = 0;
    setPlaying(false);
  }
  function travel(to: number) {
    if (to < 0 || to >= stops.length) return;
    interrupt();
    if (ready && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      motion.current = {start:performance.now(), from:pose.current.at, to, film:false};
    } else {
      pose.current.at = to;
      setStop(to);
    }
    draw.current();
  }
  function look(dx: number, dy = 0) {
    interrupt();
    pose.current.yaw += dx;
    pose.current.pitch = THREE.MathUtils.clamp(pose.current.pitch + dy, -1.48, 1.48);
    draw.current();
  }
  function zoom(delta: number) {
    interrupt();
    pose.current.fov = THREE.MathUtils.clamp(pose.current.fov + delta, 45, 105);
    draw.current();
  }
  async function download() {
    if (recording.current || !ready) return;
    const controller = new AbortController();
    recording.current = controller;
    setSaving(true);
    setMessage('');
    let writer: ReturnType<typeof panoramaRenderer> | undefined;
    try {
      const output = document.createElement('canvas');
      writer = panoramaRenderer(output, textures.current, true);
      writer.resize(1280, 720);
      const file = await encodeCanvas(output, tourDuration, controller.signal,
        progress => writer!.draw(filmPose(progress, stops.length)));
      controller.signal.throwIfAborted();
      const href = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = href;
      link.download = 'spatium-walkthrough.webm';
      link.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      if (id !== 'demo') void fetch(`/api/scenes/${id}/events/export`, {method:'POST'}).catch(() => {});
    } catch {
      if (!controller.signal.aborted) setMessage('Video encoding failed. Try downloading again in Chrome.');
    } finally {
      writer?.dispose();
      recording.current = null;
      setSaving(false);
    }
  }
  const backwards = Math.cos(heading * Math.PI / 180) < 0;
  const next = stop + (backwards ? -1 : 1);
  const bearing = Math.atan2(Math.sin(heading*Math.PI/180),Math.cos(heading*Math.PI/180));
  return <section aria-label="Panoramic walkthrough">
    <div className="tour-frame" ref={container} tabIndex={0} aria-label="Walkthrough. Drag to look. Use left and right arrows to turn, W and S to walk."
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return;
        const keys: Record<string, () => void> = {
          ArrowLeft: () => look(-0.16), ArrowRight: () => look(0.16),
          ArrowUp: () => look(0,0.12), ArrowDown: () => look(0,-0.12),
          '+': () => zoom(-6), '=': () => zoom(-6), '-': () => zoom(6),
          w: () => travel(next), s: () => travel(stop - (backwards ? -1 : 1)),
        };
        if (keys[e.key]) {e.preventDefault(); keys[e.key]();}
      }}>
      <img className="tour-still" src={stops[stop]?.url} alt={`Panoramic view at ${stops[stop]?.label}`}/>
      <canvas key={urls} ref={canvas} style={{opacity:ready ? 1 : 0}}
        onPointerDown={e => {
          if (!ready || pointers.current.size >= 2 || e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.parentElement?.focus({preventScroll:true});
          pointers.current.set(e.pointerId, {x:e.clientX, y:e.clientY});
        }}
        onPointerMove={e => {
          const last = pointers.current.get(e.pointerId);
          if (!last) return;
          const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)?.[1];
          if (other) {
            const before = Math.hypot(other.x-last.x, other.y-last.y);
            const after = Math.hypot(other.x-e.clientX, other.y-e.clientY);
            zoom((before-after)*0.25);
          } else {
            look((last.x-e.clientX)*0.006, (e.clientY-last.y)*0.006);
          }
          pointers.current.set(e.pointerId, {x:e.clientX,y:e.clientY});
        }} onLostPointerCapture={e => {pointers.current.delete(e.pointerId);}}/>
      <span className="tour-position">{stop + 1} / {tour.count} · {stops[stop]?.label}</span>
      {document.fullscreenEnabled && <button className="tour-expand" aria-label="Toggle fullscreen" onClick={() => {
        const operation = document.fullscreenElement ? document.exitFullscreen() : container.current?.requestFullscreen();
        operation?.catch(() => setMessage('Fullscreen is unavailable in this window.'));
      }}>⛶</button>}
      {ready && !playing && next >= 0 && next < stops.length && Math.abs(Math.sin(bearing)) < .72 &&
        <button className="waypoint" style={{left:`${50 - Math.tan(bearing)*45}%`}} onClick={() => travel(next)}>
          ↑ {stops[next].label}
        </button>}
    </div>
    <div className="tour-stops" aria-label="Walkthrough stops">{stops.map((s,i) =>
      <button key={s.url} aria-current={i === stop ? 'step' : undefined} onClick={() => travel(i)}>{s.label}</button>)}</div>
    <p className="quiet">{ready ? 'Drag to look around. Select a stop to walk there.' : message || 'Opening panoramic view…'}</p>
    {ready && <div className="viewer-actions">
      <button onClick={() => look(Math.PI)}>Turn around</button>
      <button onClick={() => {interrupt(); pose.current = {...startPose}; draw.current();}}>Reset</button>
      {stops.length === tour.count && <>
        <button onClick={() => {
          if (playing) {motion.current = null; setPlaying(false);}
          else {motion.current = {start:performance.now()-elapsed.current, from:0,to:0,film:true}; setPlaying(true); draw.current();}
        }}>{playing ? 'Pause walkthrough' : 'Play walkthrough'}</button>
        <button className="download" onClick={() => void download()} disabled={saving || !canExportVideo()}>
          {saving ? 'Encoding…' : 'Download walkthrough'}
        </button>
      </>}
    </div>}
    {ready && message && <p role="status">{message}</p>}
  </section>;
}
