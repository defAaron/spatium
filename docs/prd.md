# Spatium product requirements

Draft · 21 November 2026

Spatium turns one photo of a real place into a miniature walkthrough. The user explores three connected 360° stops in the browser and can download the visit as a short video. The place should stay recognizable after the style changes. Views the photo does not show, such as the space behind the photographer, are invented.

## First release

The audience is someone who wants to wander through a familiar place as a miniature or share a short clip of it. They bring one photo and their own Magic Hour API key. The release offers one handcrafted miniature style, three stops along one route, an interactive panorama viewer and a downloadable ten-second walkthrough. Each stop is a billable image edit.

The depth miniature from earlier drafts, a single-view parallax diorama, was removed on 21 November 2026. The walkthrough covers the same use and adds 360° movement.

### User flow

1. Open the site. The bundled sample walkthrough plays without a key. Paste a Magic Hour key into a masked field. Drop or select a JPEG, PNG or WebP up to 10 MB and preview it. Explain beside the form that Magic Hour receives the photo and charges credits to the supplied key.
2. Select **Generate walkthrough**. Show which stop is being prepared and display each stop as soon as it is available.
3. Travel between **Arrival**, **Up close** and **Beyond the landmark** with the stop tabs, the in-scene arrow or the W and S keys. Drag, use arrow keys or pinch to look around and zoom. Provide **Turn around** and **Reset** controls, and let the user play or pause the guided route.
4. Select **Download walkthrough** to export the route as a silent ten-second WebM. Export uses the same path as playback. Desktop Chrome is the initial export target. Browsers without WebM encoding can still use the viewer when WebGL is available.

### Acceptance criteria

| Area | Required behavior |
| --- | --- |
| Upload and billing | Validate the file before calling Magic Hour. One submission creates at most three image projects, one per stop. Disable repeated clicks while submitting, and display the total credits charged when Magic Hour reports them. Regeneration requires an explicit action that may spend credits. |
| Scene quality | Each stop is a seamless 2:1 panorama. Landmarks from the photo keep their number, layout and identity across stops. Obvious seams, collages and duplicated landmarks are absent in the accepted fixtures. |
| Controls | Travel, look, zoom, turn around, reset and playback work with mouse, touch or keyboard where applicable. Reduced-motion preferences suppress animated travel. |
| Export | Desktop Chrome produces a playable 1280 × 720 WebM, 300 frames over ten seconds, from the same route used by playback. An export error leaves the viewer usable and can be retried without another paid edit. |
| Recovery | Invalid key, insufficient credits, unsupported image, provider delay and rendering failure have distinct messages. Completed stops stay viewable after an interruption. Resuming with the key generates only the missing stops. |
| Privacy | The site keeps the key only in temporary memory during processing and never logs it. Spatium's generated assets expire after 24 hours. Explain that Magic Hour handles its own copies under its own terms. |

## Validation

- Build a 12-photo set spanning rooms, streets, landscapes and challenging foregrounds such as fences and foliage. Have two reviewers check whether the place stays recognizable at every stop and whether landmarks stay consistent between stops. Provisional target is 10 of 12 photos passing both checks.
- Track time from submission to the first stop, to a ready walkthrough and to the interactive view, plus exports completed and credits per accepted result.
- Launch scope is one photo, one style, one session-scoped result and one route. Later candidates include MP4, additional styles, saved projects and more stops.

See the [technical architecture](architecture.md) for the Magic Hour endpoint and rendering pipeline, and the [implementation plan](implementation-plan.md) for the build order and test gates.
