import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './scene';
import type { Scene, Stage } from './scene';
import { Walkthrough } from './Walkthrough';
import { Viewer } from './Viewer';
import './style.css';

const statusText: Record<Stage, string> = {
  uploading: 'Uploading photo…',
  stylizing: 'Making your miniature…',
  estimating_depth: 'Preparing the interactive scene…',
  ready: 'Scene ready',
  still_ready: 'Still image ready',
  failed: 'Generation failed',
  needs_key: 'Key needed to resume',
};

function pending(stage?: Stage) {
  return stage === 'uploading' || stage === 'stylizing' || stage === 'estimating_depth';
}

function App() {
  const [tourMode, setTourMode] = useState(true);
  const [demo, setDemo] = useState<Scene>();
  const [scene, setScene] = useState<Scene>();
  const [liveEnabled, setLiveEnabled] = useState<boolean>();
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
    api<{ liveEnabled: boolean }>('/api/config', { signal: request.signal })
      .then(async (config) => {
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
        setLiveEnabled(config.liveEnabled);
      })
      .catch(() => {
        if (!request.signal.aborted) setError('The Spatium API is unavailable. Start the local server and reload.');
      });
    api<Scene>('/api/demo', { signal: request.signal })
      .then(setDemo)
      .catch(() => {
        if (!request.signal.aborted) setError('The sample scene could not be loaded. Check the local API.');
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
    if (!key || !photo || liveEnabled === undefined || (!tourMode && !liveEnabled) || processing || submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setError('');
    const form = new FormData();
    submission.current ||= crypto.randomUUID();
    form.set('submission', submission.current);
    form.set('photo', photo);
    form.set('key', key);
    try {
      setScene(await api<Scene>(tourMode ? '/api/walkthroughs' : '/api/scenes', { method: 'POST', body: form }));
      submission.current = '';
      if (keyField.current) keyField.current.value = '';
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The request could not be submitted.');
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  async function recover(resume = false) {
    if (!sceneId || submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setError('');
    try {
      const form = new FormData();
      if (resume) form.set('key', keyField.current?.value.trim() || '');
      setScene(await api<Scene>(`/api/scenes/${sceneId}/${resume ? 'resume' : 'depth'}`, {
        method: 'POST', body: resume ? form : undefined,
      }));
      if (resume && keyField.current) keyField.current.value = '';
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Try preparing depth again.');
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  const sampleTour = {count: 3, stops: ['Arrival', 'Up close', 'Beyond the landmark'].map((label, i) =>
    ({label, url: `/assets/walkthrough/stop-${i}.jpg`}))};
  const tour = scene?.walkthrough ?? (!scene && tourMode ? sampleTour : undefined);
  const displayed = scene?.image ? scene : scene ? undefined : demo;
  const enabled = liveEnabled !== undefined && (tourMode || liveEnabled);
  const resuming = scene?.stage === 'needs_key';
  return (
    <main className="shell">
      <header>
        <p className="wordmark">Spatium</p>
        <h1>Step inside<br />a photograph.</h1>
        <p className="intro">Explore an imagined miniature from three places, then take the walkthrough with you.</p>
      </header>

      <div className="workspace">
        <form className="panel form" onSubmit={scene?.stage === 'needs_key' ? (e) => { e.preventDefault(); void recover(true); } : generate}>
          <h2>Source photo</h2>
          <fieldset disabled={submitting || processing}>
            <label htmlFor="scene-format">Experience</label>
            <select id="scene-format" value={tourMode ? 'tour' : 'still'} disabled={resuming}
              onChange={event => { setTourMode(event.target.value === 'tour'); submission.current = ''; }}>
              <option value="tour">360° walkthrough</option>
              <option value="still">Depth miniature</option>
            </select>
            <input
              ref={fileField} type="file" accept="image/jpeg,image/png,image/webp"
              className="visually-hidden" tabIndex={-1} aria-label="Source photo"
              onChange={(event) => {
                selectPhoto(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            <button
              type="button" className={`drop ${dragging ? 'dragging' : ''}`}
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
              {photo && preview && <img src={preview} alt="" />}
              <span>{photo ? photo.name : 'Drop a photo or browse'}</span>
              <small>JPEG, PNG, or WebP up to 10 MB</small>
            </button>
            <label htmlFor="magic-key">Magic Hour API key</label>
            <input id="magic-key" ref={keyField} type="password" autoComplete="off" required
              maxLength={512} placeholder="Paste your key" disabled={!enabled && !resuming} />
            <p className="quiet">{resuming && scene.walkthrough
              ? 'Completed stops are saved. Resuming may create the remaining paid edits.'
              : tourMode ? 'Magic Hour receives one photo and charges for three image edits. AI imagines the unseen sides of your scene.'
              : 'Magic Hour receives your photo and charges for one image edit.'}</p>
            <button className="generate" type="submit" disabled={!resuming && (!enabled || !photo)}>
              {submitting ? 'Submitting…' : processing ? 'Generating…' : resuming ? 'Resume existing edit'
                : tourMode ? 'Generate walkthrough' : 'Generate miniature'}
            </button>
          </fieldset>
          <p className="quiet">Your scene expires after 24 hours. Magic Hour handles its own copies under its terms.</p>
          {!tourMode && liveEnabled === false && <p className="quiet">Demo mode. Install the optional depth dependencies to generate from your photo.</p>}
          {error && <p className="error" role="alert">{error}</p>}
        </form>

        <section className="panel result" aria-labelledby="result-title">
          <div className="result-heading">
            <h2 id="result-title">{scene ? (tour ? 'Your walkthrough' : 'Your miniature') : (tour ? 'Sample walkthrough' : 'Sample scene')}</h2>
            {scene && demo && <button type="button" disabled={submitting || processing} onClick={() => { sessionStorage.removeItem('spatium.scene'); setScene(undefined); }}>Show sample</button>}
          </div>
          {tour?.stops.length ? <Walkthrough key={scene?.id ?? 'demo-tour'} id={scene?.id ?? 'demo'} tour={tour} />
            : displayed && !tour ? <Viewer key={`${displayed.id}-${Boolean(displayed.depth)}`} scene={displayed} />
            : <div className="placeholder">{processing ? 'Waiting for your miniature…' : 'Your miniature will appear here.'}</div>}
          {scene && (
            <div className="job-status" role="status">
              <span>{scene.walkthrough && processing ? `Preparing stop ${Math.min(3, scene.walkthrough.stops.length + 1)} of 3…` : statusText[scene.stage]}</span>
              {scene.credits !== null && <span>{scene.credits} credits charged</span>}
            </div>
          )}
          {scene?.error && <p className="error" role="alert">{scene.error}</p>}
          {scene?.stage === 'still_ready' && (
            <button disabled={submitting} type="button" onClick={() => void recover()}>Retry depth</button>
          )}
        </section>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
