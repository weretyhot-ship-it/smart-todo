/* ============================================================================
   glass-card.js — frame sync for the liquid-glass todo card
   ----------------------------------------------------------------------------
   The card is a window onto a refracted duplicate of the background video:

     1. measure the card every frame
     2. park #dup-video-container at (-rect.left, -rect.top) so that the copy
        lines up 1:1 with the real video behind the card
     3. draw the current video frame into the canvas, reproducing
        object-fit: cover
     4. the canvas carries filter: url(#liquid-glass-refraction) in CSS, so the
        browser refracts it while compositing

   No exports: the script starts itself.
   Wrapped in an IIFE on purpose: these are classic scripts (so the page also
   works when opened straight from disk), and classic scripts share the global
   scope. Without this wrapper `const video` here and `const video` in ui.js
   would collide and ui.js would die with a SyntaxError.
   ========================================================================= */

(function () {
'use strict';

const DUP_PIXEL_RATIO = 1;   // 1x on purpose, see note at the bottom

const video = document.getElementById('bg-video');
const card = document.querySelector('[data-glass-card]');
const container = document.getElementById('dup-video-container');
const canvas = document.getElementById('dup-image');

if (video && card && container && canvas) {
  const ctx = canvas.getContext('2d');
  let cssW = 0;
  let cssH = 0;
  let started = false;

  /* ---------------------------------------------------------------- helpers */
  function viewportSize() {
    return {
      w: document.documentElement.clientWidth,
      h: document.documentElement.clientHeight,
    };
  }

  /* make sure the video really plays (autoplay can be refused in odd states) */
  function kickVideo() {
    if (!video) return;
    const p = video.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }
  video.addEventListener('canplay', kickVideo);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) kickVideo();
  });
  kickVideo();

  /* ------------------------------------------------------------- main loop */
  function frame() {
    requestAnimationFrame(frame);
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;

    const rect = card.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const { w: vw, h: vh } = viewportSize();
    if (vw === 0 || vh === 0) return;

    /* park the duplicate exactly over the viewport origin; the card's
       overflow:hidden + border-radius clip it back to the card shape */
    container.style.left = -rect.left + 'px';
    container.style.top = -rect.top + 'px';
    container.style.width = vw + 'px';
    container.style.height = vh + 'px';

    const w = Math.round(vw * DUP_PIXEL_RATIO);
    const h = Math.round(vh * DUP_PIXEL_RATIO);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      cssW = w;
      cssH = h;
    }

    /* object-fit: cover, done by hand */
    const cover = Math.max(vw / video.videoWidth, vh / video.videoHeight);
    const sw = vw / cover;
    const sh = vh / cover;
    const sx = (video.videoWidth - sw) / 2;
    const sy = (video.videoHeight - sh) / 2;

    try {
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
      if (!started) {
        started = true;
        document.documentElement.dataset.glassReady = '1';
      }
    } catch (e) {
      /* a frame may not be decodable yet (or the canvas is tainted:
         drawing stays allowed, only pixel read-back would fail) */
    }
  }

  requestAnimationFrame(frame);
}

})();

/* ----------------------------------------------------------------------------
   Notes worth keeping:

   * The duplicate is sized to the VIEWPORT, not to the card, on purpose.
     The filter shifts each colour channel by a different amount, so the
     filtered element's own leading edges show hard channel-separation bands.
     At viewport size those bands fall outside the card, so only clean
     refraction shows through.

   * The canvas stays at 1x even on retina: the SVG filter's cost scales with
     pixel count, and what shows through is a soft refraction where 4x the
     filter work buys nothing visible.
   ------------------------------------------------------------------------- */
