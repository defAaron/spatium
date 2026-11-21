# Spatium implementation plan

This is the source of truth for implementing and verifying the first release. The [PRD](prd.md) defines release scope and acceptance criteria. The [architecture](architecture.md) defines the technical contracts. The release takes one real-world photo and a user-supplied Magic Hour key, generates three connected miniature panoramas, opens them as an interactive walkthrough, and exports the guided route as a ten-second WebM.

Sections 5 to 7 describe the depth miniature, which was removed on 21 November 2026 (see section 11). They remain as a record and need no further work.

## How to execute this plan

1. Start at the first incomplete numbered subproblem. Review its prerequisites, inspect the named files, and reuse the scaffold where it meets the contract.
2. Complete the task checklist and run the test gate immediately. Fix failures and rerun the gate before advancing. Add regression checks for new behavior or reproduced failures to the appropriate suite.
3. Record the date, commands or manual steps, result, and any blocker under the subproblem. Keep fixture IDs and artifact references where they help reproduce a result. Mark the subproblem complete only after its gate passes. If blocked, record the missing prerequisite and the checks that ran.
4. Use generated fixtures, mocked provider responses, temporary data directories, and an injectable clock for routine checks. Run paid calls only with authorization for the supplied key and credit spend. Keep keys, signed URLs, and private photos out of fixtures, logs, and completion records.

The scaffold already has a demo, upload form, Magic Hour adapter, depth implementation, and WebM encoder. Earlier build, mocked API, CPU inference, and Chromium smoke checks established feasibility. A Chromium sample export previously decoded as 180 frames over six seconds. Those checks are baseline evidence. Each gate below still needs a repeatable pass for completion.

## 1. Establish a repeatable baseline

**Prerequisite** · Node.js 22, Python 3.11+, and uv.  
**Start in** · `README.md`, `package.json`, `pyproject.toml`, `spatium/demo.py`.

- [x] Confirm a clean install from both lockfiles and verify the Vite development proxy and built same-origin entry point.
- [x] Add backend integration checks using Python `unittest` and HTTPX's ASGI transport, with temporary app state and no live provider calls. Document the invocation `uv run python -m unittest discover -s tests`.
- [x] Add a Chromium smoke runner for the sample scene and expose it as `npm run test:e2e`. Document browser installation and how the runner starts and stops the local server.

**Test gate** · Run `npm ci`, `uv sync`, `npm run build`, the backend suite, and `npm run test:e2e`. Check that health and config respond, the demo manifest matches the returned image and depth byte length, and the demo loads without a Magic Hour key or local model weights.

**Completion record** · 21 November 2026 · npm ci, uv sync --locked, npm run build, uv run python -m unittest discover -s tests, and npm run test:e2e passed. The runner checked Vite proxy health and rendered the built demo in Chromium without depth extras.

## 2. Secure photo intake and browser sessions

**Prerequisite** · Subproblem 1.  
**Start in** · `spatium/main.py`, `src/main.tsx`, `src/scene.ts`.

- [x] Enforce upload and decoded-pixel limits, accept still JPEG, PNG, and WebP, normalize EXIF orientation, and strip metadata before passing bytes to the edit pipeline.
- [x] Require a valid session for job creation, status, retry, and asset access. Use a signed session cookie with appropriate HTTPS and HTTP-only attributes.
- [x] Complete the masked-key form, file picker and drop target, source preview, billable-action copy, and actionable validation feedback. Keep the key in transient memory and clear the field after acceptance.

**Test gate** · Run the backend and Chromium suites. Submit each supported format and reject corrupt, animated, oversized, or excessive-pixel inputs before any provider call. Verify orientation and metadata stripping, key-field clearing, and denied status and asset access from a second session.

**Completion record** · 21 November 2026 · API suite and Chromium suite passed. Tested EXIF rotation and metadata removal for three formats, invalid and over-limit files, forged and second-session cookies, and key clearing on acceptance.

## 3. Make jobs durable and restartable

**Prerequisite** · Subproblem 2.  
**Start in** · `spatium/main.py` and the job-processing section of the architecture.

- [x] Persist scene metadata in SQLite and assets on a private persistent volume. Publish asset metadata only after the corresponding file is committed.
- [x] Enforce uniqueness on session and submission ID. Persist the paid-step marker before dispatch and store the provider project ID and credits once returned. Reuse the same scene for duplicate submissions.
- [x] Bound the worker queue and submission rate. Persist enough state to resume known provider projects after key re-entry and retry depth from a saved still without a key.
- [x] Expire jobs and assets after 24 hours. Handle interrupted writes and ensure expired assets are unavailable through scene routes.

**Test gate** · Run the backend suite against a temporary database and volume. Race duplicate submissions and confirm a single worker claim. Simulate restarts before dispatch, after dispatch with an unknown result, after the provider ID is saved, and after the still is saved. Verify no duplicate paid dispatch and exercise queue saturation, asset isolation, and expiry with a controlled clock.

**Completion record** · 21 November 2026 · Temporary-volume API and restart tests passed. Racing requests returned the same scene with one worker. Saturation, ownership, controlled expiry and all four interruption points passed.

## 4. Complete Magic Hour generation and recovery

**Prerequisite** · Subproblem 3.  
**Start in** · `spatium/magic_hour.py`, `spatium/main.py`, `src/main.tsx`.

- [x] Upload normalized bytes using the signed upload URL, submit one `flux-2-klein` image edit at `1k`, and store the project ID and credits. Keep the authorization header scoped to provider API calls.
- [x] Implement bounded polling and safe retries for status and asset retrieval. Persist the stylized still promptly and expose it while depth is being prepared.
- [x] Map invalid key, insufficient credits, provider delay, cancellation, and asset failures to actionable job states. Prompt for a key only when it can resume a known project. Tell the user to check Magic Hour history after an ambiguous paid request.

**Test gate** · Run the backend and Chromium suites with a mocked provider. Cover the complete upload-to-still sequence, exact edit count, credits, status transitions, expired download handling, authentication and credits failures, transient polling failures, and an edit response lost after dispatch. Verify that resuming or retrying reads never creates a second edit. The authorized live provider check is in subproblem 9.

**Completion record** · 21 November 2026 · Seven backend checks and the Chromium workflow passed. HTTPX MockTransport verified one paid request, scoped headers, transient status and expired asset URL recovery. Chromium resumed a known project after reload and retried depth on the saved still.

## 5. Produce a versioned depth scene

**Prerequisite** · Subproblem 4.  
**Start in** · `spatium/depth.py`, `spatium/main.py`, `src/scene.ts`.

- [x] Run Depth Anything V2 Small on the stylized still outside the request loop. Map its prediction back to the still's coordinates and verify that nearer pixels have smaller encoded depths.
- [x] Publish the little-endian 16-bit buffer with dimensions, version, and the image and camera parameters needed by both viewer and export.
- [x] Detect flat or invalid predictions. Keep the still visible and let the user retry inference from the saved still.

**Test gate** · Run the backend suite with synthetic depth outputs to check orientation, normalization, buffer size, and flat or non-finite fallback. With the optional model installed, run CPU inference on a local fixture and verify a finite, non-flat output with the expected aspect ratio. Force a depth failure and retry with the existing still, confirming no additional edit.

**Completion record** · 21 November 2026 · Eight backend checks passed with the depth extra, including row order, near/far encoding, flat and non-finite fallback. HF_HUB_OFFLINE=1 CPU inference using the cached model produced a non-flat 256 × 171 buffer for the 960 × 640 demo. Repeat with python -m tests.cpu_smoke. Chromium depth retry reused the still.

## 6. Make the 2.5D viewer usable and resilient

**Prerequisite** · Subproblem 5.  
**Start in** · `src/Viewer.tsx`, `src/viewport.ts`, `src/style.css`.

- [x] Build the textured mesh from the scene manifest and keep reset aligned with the stylized still. Tune depth discontinuities, background fill, and camera bounds on scenes with overlapping objects.
- [x] Support pointer drag, wheel and pinch zoom, keyboard controls, reset, and explicit play and pause. Honor reduced-motion preferences for automatic motion.
- [x] Keep the still usable when WebGL is unavailable or its context is lost. Verify resource cleanup when switching scenes.

**Test gate** · Run the Chromium suite on deterministic fixtures. Check that a camera translation moves near and far elements differently, reset restores the reference framing, and keyboard, mouse, and touch controls stay within bounds. Check narrow viewports, reduced-motion behavior, and the still fallback. Manually inspect a scene with thin foreground details for holes and stretching.

**Completion record** · 21 November 2026 · Chromium passed keyboard, drag clamp, wheel, two-touch pinch, reset pixel equality, play/pause, reduced motion, 375px layout, and context-loss fallback. Inspected displaced trees, roofs and mountain edges and tuned the camera range and background texture. Small edge artifacts remain at maximum drag; real-photo quality requires gate 9.

## 7. Export the shared camera move

**Prerequisite** · Subproblem 6.  
**Start in** · `src/viewport.ts`, `src/Viewer.tsx`.

- [x] Use the same scene, camera parameters, and sweep function for playback and export. Encode 180 frames at 30 fps with explicit timestamps, preserve the aspect ratio within pixel rounding, and enforce the resolution caps.
- [x] Show encoding progress at least as an in-progress state. Handle missing browser support and failed encoding while leaving the viewer usable and the export retryable.

**Test gate** · Run `npm run build` and the Chromium suite. Download exports for landscape and portrait fixtures, then decode them in Chromium or inspect them with `ffprobe`. Require a playable six-second WebM with 180 frames and no audio. Compare start, midpoint, and end framing against the shared sweep. Force an encoder error and verify that retry uses the same scene without a provider call.

**Completion record** · 21 November 2026 · Fresh build and Chromium tests passed. ffprobe decoded 180 VP8 frames over 6 seconds with no audio at 960 × 640 and 440 × 640. Decoded frames 0, 90 and 179 matched controlled playback poses within the luminance tolerance. A forced encoder failure allowed an immediate retry.

## 8. Verify the full workflow in the release build

**Prerequisite** · Subproblem 7.  
**Start in** · `README.md`, `src/main.tsx`, `spatium/main.py`.

- [x] Complete user-facing copy for billing, the 24-hour asset lifetime, and Magic Hour's handling of provider-side copies. Make status changes readable without depending on visual cues.
- [x] Document local operation and a same-origin release configuration with HTTPS, a persistent volume, worker limits, and health checking.
- [x] Record stage timings, render failures, successful exports, and credits in a form usable for release evaluation. Keep user photos and credentials out of telemetry.

**Test gate** · Run all automated suites against a fresh build. With the provider mocked, take a photo through selection, submission, spend reporting, still preview, interaction, and video download. Exercise interrupted work, key re-entry for a known job, depth retry, stale or expired scenes, and demo use without credentials. Check the release configuration starts with a writable data volume and serves frontend and API from one origin.

**Completion record** · 21 November 2026 · Fresh production build, eight backend tests and the full Chromium flow passed on a temporary volume. Tested submission through download, reload and key re-entry, depth retry, expired scene and credential-free sample. Verified per-scene timing, failed depth attempt and export counter in the private metrics report.

## 9. Validate live quality and release readiness

**Prerequisite** · Subproblem 8 and authorized access to a Magic Hour key and credit budget.  
**Start in** · [PRD validation](prd.md#validation) and [Magic Hour model choice](architecture.md#magic-hour-tool-choice).

- [x] Prepare 12 approved photos covering rooms, streets, landscapes, and foreground challenges such as fences and foliage. Keep private fixture files out of Git and use stable IDs in evidence.
- [ ] Verify one live upload-to-export walkthrough with the default model. Evaluate the full fixture set, record time to the first stop, to ready and to interaction, credits per accepted result, and export outcomes.
- [ ] Have two reviewers score recognizability and landmark consistency across stops. Use their results and the observed timings to set latency targets and tune the model or prompts.

**Test gate** · Run the release smoke against the intended environment with authorized live access. Recheck any changed defaults through the earlier gates they affect. Verify the PRD acceptance criteria and record the scorecard against the provisional threshold of 10 of 12 photos. Include at least one real six-second export and confirm the requested photo, provider charges, and result agree.

**Completion record** · 21 November 2026 · Prepared and decoded 12 high-resolution public-domain photographs from the Library of Congress, Prints & Photographs Division, by Carol M. Highsmith. Completed one live `flux-2-klein` / `1k` edit through the local release UI. Magic Hour reported five credits. The still retained both pumps, the roofline and the Texaco sign. The first sweep broke up thin edges at the signpost and stretched the pump outlines. Reused the same stored still and depth, smoothed the depth mesh, kept silhouettes connected and narrowed the camera excursion. Decoded the revised 1024 × 640 VP8 export: one video track, 180 frames, 30 fps, 6.000 s. Inspection at frames 45 and 134 found a continuous signpost; patch tracking measured 19 horizontal pixels of movement at the nearer pump and 9 at the distant treeline. The other 11 paid edits, candidate models, latency targets and two independent human scores are reserved for final quality review.

The local evaluation artifacts are in `.spatium/evaluation/flux-2-klein/gas-station/`: `still.jpg`, `sweep.webm` (initial), `sweep-tuned.webm` (revised), and `result.json`. The original is in `.spatium/evaluation/photos/gas-station.jpg`.

Use the local originals in `.spatium/evaluation/photos/`. For each clip, both reviewers independently record whether the photographed place and its landmarks remain recognizable, whether near and far objects move differently, and whether visible tears or stretching distract at the preset range. Record a pass only when both reviewers accept all three criteria. Target 10 of 12. Record seconds to still and first interaction, provider credits, export verification and both reviews before accepting or changing the model.

| Fixture and source | Still / interactive (s) | Credits | WebM | Reviewer 1 | Reviewer 2 |
| --- | --- | --- | --- | --- | --- |
| [slot-canyon](https://www.loc.gov/resource/highsm.17618/) | — | — | — | — | — |
| [gas-station](https://www.loc.gov/resource/highsm.65037/) | 13.80 / 19.31 | 5 | Verified, tuned | — | — |
| [bridge-cables](https://www.loc.gov/resource/highsm.20964/) | — | — | — | — | — |
| [snowy-street](https://www.loc.gov/resource/highsm.37151/) | — | — | — | — | — |
| [chalk-pyramids](https://www.loc.gov/resource/highsm.67093/) | — | — | — | — | — |
| [mountain-foliage](https://www.loc.gov/resource/highsm.12933/) | — | — | — | — | — |
| [river](https://www.loc.gov/resource/highsm.71611/) | — | — | — | — | — |
| [arcade-interior](https://www.loc.gov/resource/highsm.41461/) | — | — | — | — | — |
| [falls-footbridge](https://www.loc.gov/resource/highsm.16878/) | — | — | — | — | — |
| [statehouse-rotunda](https://www.loc.gov/resource/highsm.52518/) | — | — | — | — | — |
| [oak-branches](https://www.loc.gov/resource/highsm.44175/) | — | — | — | — | — |
| [east-german-street](https://www.loc.gov/resource/highsm.31352/) | — | — | — | — | — |

[Collection rights statement](https://wwws.loc.gov/rr/print/res/482_high.html)

## 10. One-photo walkthrough

The revised product accepts a single still and invents scenery outside its borders.
Build three linked panoramic camera positions, preserve each completed edit across
interruptions, and expose the cost before generation. The viewer must support turning
all the way around, travelling to a different stop, returning, and playing and
exporting the same walkthrough. Keep the legacy depth viewer for existing jobs.

**Gate** · Exercise generation, partial recovery, ownership, movement, look-back,
reduced motion, and a decoded walkthrough export with the provider mocked. Inspect
a generated tour if authorized.

**Completion record** · 21 November 2026 · Production build, 10 backend tests and
Chromium workflow passed. The browser exercised travel and return, full-circle
orientation, restored sessions, playback and a 300-frame video download. Recovery
tests covered a known provider project, an uncertain paid dispatch, and a restart
between stops with previously published assets intact. The legacy viewer and its
landscape/portrait exports passed in the same run.

One authorized live walkthrough used the gas-station fixture and three baseline
edits for 15 credits total. The first panorama arrived in 6.78 seconds and the
three-stop job finished in 30.97 seconds. Inspection showed distinct viewpoints
and differences in pump details, including a duplicated shelter in the far view.
Aligned the sample's far-stop heading, requested a centered reverse viewpoint
for future far-stop generations, and checked the revised request with mocks.
The demo and exported route reuse the paid images. The final video is a silent
1280 × 720 VP8 WebM, 300 frames at 30 fps over 10 seconds.

**Model comparison** · 21 November 2026 · Ran one live walkthrough of the gas-station
fixture with `gpt-image-2` at `1k`, with each later stop referencing the source photo and
every earlier stop. Magic Hour charged 100 credits per stop, 300 in total, compared with
15 for `flux-2-klein`. The stops agreed more closely: the same two white Texaco pumps, red
barrel, curved sign pole, fence and white road line appear at the first two stops, and the
far stop shows one building from behind, not the duplicate `flux-2-klein` produced. The
1280 × 720 export decoded to 300 frames over 10 seconds and ends on the back of the same
building. Artifacts are in `.spatium/walkthrough-gpt-image-2/`.

**Sample and interface refresh** · 21 November 2026 · Replaced the sample walkthrough with the
three `gpt-image-2` stops from the model comparison (1440 × 720), so no new credits were spent.
Restyled the interface after a light editorial layout: one control panel, icon
controls beside the stop tabs, and shorter copy. A CSS spinner during
export stalled WebM encoding in headless SwiftShader Chromium, so the busy state is a static
label. `npm run build`, the backend suite and `npm run test:e2e` passed.

## 11. Remove the depth miniature

**Completion record** · 21 November 2026 · Removed the depth miniature so the walkthrough is the only experience. Deleted `Viewer.tsx`, the depth mesh code (the WebM encoder moved to `src/video.ts`), `spatium/depth.py`, `spatium/demo.py`, `POST /api/scenes`, the depth retry route, the demo routes, the optional `depth` dependencies and their tests. Scene records drop the still, depth and failure fields, and the store deletes legacy miniature rows on startup. `/api/config` now only issues the session cookie. The metrics report shows `first_stop_seconds` in place of `still_seconds`. The PRD, architecture, README and AGENTS.md describe the walkthrough only. `npm run build`, `uv run python -m unittest discover -s tests` (9 tests) and `npm run test:e2e` passed.
