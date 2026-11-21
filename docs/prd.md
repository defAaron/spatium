# Spatium product requirements

Draft · 21 November 2026

## One-photo walkthrough revision

The default experience now takes one source photo and creates three connected panoramic stops. The user can move to a stop, turn 360 degrees, look behind them and export a ten-second walkthrough. Missing views are invented. Each stop is a billable image edit. The depth miniature described below remains available as a separate experience.


Spatium turns a photo of a real place into a miniature diorama you can explore in the browser and download as a short camera move. A street, room, or landscape should remain recognizable after the style changes. Dragging the view should reveal different rates of motion between near and far objects, giving it a sense of depth.

## First release

The initial audience is someone who wants to see a familiar place as a miniature or share a short clip of it. They bring one photo and their own Magic Hour API key. The first release offers one handcrafted diorama style, an interactive viewer, and a downloadable six-second camera move. The viewing angle stays close to the original viewpoint because a single photo supplies one view of the scene.

### User flow

1. Open the site and paste a Magic Hour key into a masked field. Drop or select a JPEG, PNG, or WebP up to 10 MB and preview it. Explain beside the form that Magic Hour receives the photo and charges credits to the supplied key.
2. Select **Generate miniature**. Show progress for upload, stylization, and depth preparation. Keep the source preview visible and show the stylized still as soon as it is available.
3. Explore the result with drag, scroll or pinch to zoom, and a reset control. Provide keyboard controls and let the user explicitly play or pause a gentle camera sweep.
4. Select **Download video** to export the preset sweep as a silent six-second WebM. Export uses the same scene and camera path as playback. Desktop Chrome is the initial export target. Browsers without WebM encoding can still use the viewer when WebGL 2 is available.

### Acceptance criteria

| Area | Required behavior |
| --- | --- |
| Upload and billing | Validate the file before calling Magic Hour. One submission creates one image project. Disable repeated clicks while submitting, and display credits charged when Magic Hour reports them. Regeneration requires an explicit action that may spend credits. |
| Scene quality | The output keeps the source viewpoint and major landmarks recognizable. At the default motion range, near and far elements move differently, and obvious tears, blank edges, and stretching are absent in the accepted fixtures. |
| Controls | Drag, zoom, reset, and playback work with mouse, touch, or keyboard where applicable. Reduced-motion preferences suppress automatic motion. |
| Export | Desktop Chrome produces a playable six-second WebM in the scene's aspect ratio from the same preset path used by playback. An export error leaves the viewer usable and can be retried without another paid edit. |
| Recovery | Invalid key, insufficient credits, unsupported image, provider delay, and rendering failure have distinct messages. A completed still remains viewable if depth processing or WebGL fails. Retrying depth processing reuses the still. |
| Privacy | The site keeps the key only in temporary memory during processing and never logs it. Spatium's generated assets expire after 24 hours. Explain that Magic Hour handles its own copies under its own terms. |

## Validation

- Build a 12-photo set spanning rooms, streets, landscapes, and challenging foregrounds such as fences and foliage. Have two reviewers check whether the place stays recognizable and whether the camera move produces visible parallax without distracting artifacts. Provisional target is 10 of 12 photos passing both checks.
- Track time from submission to still and to interactive view, render failures, exports completed, and credits per accepted result. Use the first runs to set latency targets and judge whether a more expensive edit model earns its cost.
- Launch scope is one photo, one style, one session-scoped result, and one motion preset. Later candidates include MP4, additional styles, saved projects, and wider camera movement with occlusion-aware reconstruction.

See the [technical architecture](architecture.md) for the Magic Hour endpoint and camera pipeline, and the [implementation plan](implementation-plan.md) for the build order and test gates.
