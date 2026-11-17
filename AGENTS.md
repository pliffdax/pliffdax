# Agent notes

## Rendering performance

Check each CSS or animation change against the rules below. Each one came from a measured regression. All the code is in `src/styles/global.css`.

- **Large shadows: use `box-shadow` on a `::before` layer behind the element** (see `.sheet-frame::before`, `.morph__paper::before`). Safari re-renders `filter: drop-shadow()` on large elements every frame on Retina screens, which caused 70-200ms stalls when a sheet opens, closes, or the view switches. Keep `drop-shadow()` for small pieces like `.sheet__corner`.
- **Animate only `transform` and `opacity`, each on its own element.** Animating `box-shadow` repainted the whole card every frame, even while the page was idle. The "in progress" pulse is now a separate `::after` dot with `transform` and `opacity`.
- **Keep `filter: contrast(1.0001)` on `.item`.** The desk engine sets a new rotate/scale on every flying card each frame. Without the filter, Firefox's WebRender re-rasterizes every glyph on the card each frame: all four workers busy, 120 → 60-90fps. With it, the card is drawn once as a surface and that surface is moved (GPU CPU ~4x lower). Safari is unaffected; in Chrome the cost is slightly higher.

Test motion changes in Safari, Firefox, and Chrome, preferably with each browser's profiler: each regression above showed up in only one engine.
