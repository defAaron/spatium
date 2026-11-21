import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './scene';
import type { Scene, Stage } from './scene';
import { Walkthrough } from './Walkthrough';
import { ArrowIcon, KeyIcon, UploadIcon } from './icons';
import './style.css';

const statusText: Record<Stage, string> = {
  uploading: 'Uploading photo…',
  stylizing: 'Generating…',
  ready: 'Walkthrough ready',
  failed: 'Generation failed',
  needs_key: 'Key needed to resume',
};

function pending(stage?: Stage) {
  return stage === 'uploading' || stage === 'stylizing';
}

function App() {
  const [scene, setScene] = useState<Scene>();
  const [sessionReady, setSessionReady] = useState(false);
  const [photo, setPhoto] = useState<File>();
  const [preview, setPreview] = useState('');
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const keyField = useRef<HTMLInputElement>(null);
  const fileField = useRef<HTMLInputElement>(null);
  const submitLock = useRef(false);
  const submission = useRef('');
  const sceneId = scene?.id;
  const processing = pending(scene?.stage);

  useEffect(() => {
    const request = new AbortController();
    api('/api/config', { signal: request.signal })
      .then(async () => {
        const saved = sessionStorage.getItem('spatium.scene');
        if (saved) {
          try {
            setScene(await api<Scene>(`/api/scenes/${saved}`, {signal: request.signal}));
          } catch (error) {
            if (request.signal.aborted) return;
            if (String(error).includes('not found or expired')) sessionStorage.removeItem('spatium.scene');
            setError(error instanceof Error ? error.message : 'Could not restore the scene.');
          }
        }
        setSessionReady(true);
      })
      .catch(() => {
        if (!request.signal.aborted) setError('The Spatium API is unavailable. Start the local server and reload.');
      });
    return () => request.abort();
  }, []);

  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  useEffect(() => {
    if (!sceneId || !processing) return;
    const controller = new AbortController();
    let timer = 0;

    async function refresh() {
      let refreshAgain = true;
      try {
        const result = await api<Scene>(`/api/scenes/${sceneId}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setScene(result);
        setError('');
        refreshAgain = pending(result.stage);
      } catch (error) {
        if (!controller.signal.aborted) {
          setError(error instanceof Error ? error.message : 'Trying to reconnect…');
          refreshAgain = !String(error).includes('not found or expired');
          if (!refreshAgain) setScene(undefined);
        }
      }
      if (refreshAgain && !controller.signal.aborted) timer = window.setTimeout(refresh, 1500);
    }

    timer = window.setTimeout(refresh, 1000);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [sceneId, processing]);

  useEffect(() => {
    if (sceneId) sessionStorage.setItem('spatium.scene', sceneId);
  }, [sceneId]);

  function selectPhoto(file?: File) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
        && (file.type || !/\.(jpe?g|png|webp)$/i.test(file.name))) {
      setPhoto(undefined);
      setError('Choose a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setPhoto(undefined);
      setError('Choose an image up to 10 MB.');
      return;
    }
    setError('');
    submission.current = '';
    setPhoto(file);
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const key = keyField.current?.value.trim();
    if (!key || !photo || !sessionReady || processing || submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setError('');
    const form = new FormData();
    submission.current ||= crypto.randomUUID();
    form.set('submission', submission.current);
    form.set('photo', photo);
    form.set('key', key);
    try {
      setScene(await api<Scene>('/api/walkthroughs', { method: 'POST', body: form }));
      submission.current = '';
      if (keyField.current) keyField.current.value = '';
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The request could not be submitted.');
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  async function resume() {
    if (!sceneId || submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setError('');
    try {
      const form = new FormData();
      form.set('key', keyField.current?.value.trim() || '');
      setScene(await api<Scene>(`/api/scenes/${sceneId}/resume`, {method: 'POST', body: form}));
      if (keyField.current) keyField.current.value = '';
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The walkthrough could not be resumed.');
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  const sampleTour = {count: 3, stops: ['Arrival', 'Up close', 'Beyond the landmark'].map((label, i) =>
    ({label, url: `/assets/walkthrough/stop-${i}.jpg`}))};
  const tour = scene ? scene.walkthrough : sampleTour;
  const resuming = scene?.stage === 'needs_key';
  return (
    <main className="shell">
      <nav className="top">
        <span className="wordmark">Spatium</span>
        <span className="eyebrow">Built with Magic Hour</span>
      </nav>
      <header className="hero">
        <h1>Step inside a <em>photograph.</em></h1>
      </header>

      <div className="workspace">
        <section className="result" aria-labelledby="result-title">
          <div className="result-bar">
            <h2 id="result-title" className="caption">{scene ? 'Your walkthrough' : 'Sample'}</h2>
            <span className="spacer" />
            {scene && (
              <span className="caption" role="status">
                {processing && <span className="pulse" />}
                {processing ? `Preparing stop ${Math.min(3, scene.walkthrough.stops.length + 1)} of 3…` : statusText[scene.stage]}
              </span>
            )}
            {scene?.credits != null && <span className="caption">{scene.credits} credits charged</span>}
            {scene && <button type="button" className="text-button" disabled={submitting || processing}
              onClick={() => { sessionStorage.removeItem('spatium.scene'); setScene(undefined); }}>Show sample</button>}
          </div>
          {tour.stops.length ? <Walkthrough key={scene?.id ?? 'demo-tour'} id={scene?.id ?? 'demo'} tour={tour} />
            : <div className="placeholder">{processing ? 'Building your scene…' : 'Your scene will appear here.'}</div>}
          {scene?.error && <p className="error" role="alert">{scene.error}</p>}
        </section>

        <form className="panel" onSubmit={scene?.stage === 'needs_key' ? (e) => { e.preventDefault(); void resume(); } : generate}>
          <fieldset disabled={submitting || processing}>
            <label className="field-label" htmlFor="magic-key">Magic Hour API key</label>
            <div className="key-input">
              <KeyIcon />
              <input id="magic-key" ref={keyField} type="password" autoComplete="off" required
                maxLength={512} placeholder="mhk_live_••••••••" disabled={!sessionReady && !resuming} />
            </div>
            <div className="rule" />
            <span className="field-label">Photo</span>
            <input
              ref={fileField} type="file" accept="image/jpeg,image/png,image/webp"
              className="visually-hidden" tabIndex={-1} aria-label="Source photo"
              onChange={(event) => {
                selectPhoto(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            <button
              type="button" className={`drop ${dragging ? 'dragging' : ''} ${photo && preview ? 'has-photo' : ''}`}
              onClick={() => fileField.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                if (!submitting && !processing) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                if (!submitting && !processing) selectPhoto(event.dataTransfer.files[0]);
              }}
            >
              {photo && preview ? <>
                <img src={preview} alt="" />
                <span className="file-name">{photo.name}</span>
              </> : <>
                <span className="upload-icon"><UploadIcon /></span>
                <strong>Drop a photo or browse</strong>
                <small>JPEG · PNG · WEBP · 10 MB</small>
              </>}
            </button>
            <button className="generate" type="submit" disabled={!resuming && (!sessionReady || !photo)}>
              {submitting ? 'Submitting…' : processing ? 'Generating…' : resuming ? 'Resume existing edit'
                : 'Generate walkthrough'}
              <ArrowIcon />
            </button>
            <p className="note">{resuming
              ? 'Finished stops are kept. Resuming may charge for the rest.'
              : 'Magic Hour receives your photo and charges about 300 credits.'}</p>
          </fieldset>
          {error && <p className="error" role="alert">{error}</p>}
        </form>
      </div>

      <footer className="footer">
        <span>Scenes expire after 24 hours. Magic Hour keeps its own copies under its terms.</span>
        <a href="https://magichour.ai" target="_blank" rel="noreferrer">Magic Hour</a>
      </footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
