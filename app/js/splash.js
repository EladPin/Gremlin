/* ═══════════════════════════════════════════════
   Gremlin splash — dot-matrix hands reveal
   Samples bright pixels from hands.png and
   re-draws them as canvas dots in random order.
═══════════════════════════════════════════════ */
(function () {

  const REVEAL_DURATION = 1800; // ms to reveal all dots
  const HOLD_DURATION   = 600;  // ms to hold after full reveal
  const THRESHOLD       = 60;   // min brightness to count as a dot (0-255)
  const SAMPLE_STEP     = 4;    // sample every N pixels (lower = more dots, slower)

  function init() {
    const canvas = document.getElementById('splashCanvas');
    if (!canvas) return;
    const img = new Image();
    img.src = 'img/hands.png';
    img.onload  = () => render(canvas, img);
    img.onerror = () => dismiss();
  }

  function render(canvas, img) {
    const CW = Math.min(Math.round(window.innerWidth * 0.88), 860);
    const CH = Math.round(CW * (img.naturalHeight / img.naturalWidth));
    canvas.width  = CW;
    canvas.height = CH;
    canvas.style.width  = CW + 'px';
    canvas.style.height = CH + 'px';

    // Sample the image off-screen at display resolution
    const off = document.createElement('canvas');
    off.width  = CW;
    off.height = CH;
    const offCtx = off.getContext('2d');
    offCtx.drawImage(img, 0, 0, CW, CH);
    const pixels = offCtx.getImageData(0, 0, CW, CH).data;

    // Collect every bright pixel as a dot
    const DOT_R = SAMPLE_STEP * 0.55; // radius slightly bigger than half-step
    const dots = [];

    for (let y = 0; y < CH; y += SAMPLE_STEP) {
      for (let x = 0; x < CW; x += SAMPLE_STEP) {
        const idx = (y * CW + x) * 4;
        const brightness = 0.299 * pixels[idx] + 0.587 * pixels[idx+1] + 0.114 * pixels[idx+2];
        if (brightness > THRESHOLD) {
          const norm = Math.min((brightness - THRESHOLD) / (255 - THRESHOLD), 1);
          dots.push({ x, y, maxAlpha: 0.15 + norm * 0.85 });
        }
      }
    }

    // Shuffle for random reveal order
    for (let i = dots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [dots[i], dots[j]] = [dots[j], dots[i]];
    }

    const ctx = canvas.getContext('2d');
    let start = null;
    let done  = false;

    function frame(ts) {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / REVEAL_DURATION, 1);
      const revealed = Math.floor(progress * dots.length);

      ctx.clearRect(0, 0, CW, CH);

      for (let i = 0; i < revealed; i++) {
        const d = dots[i];
        // Each dot fades in over a short window after it's first revealed
        const localProgress = Math.min((progress * dots.length - i) / (dots.length * 0.04), 1);
        const alpha = localProgress * d.maxAlpha;
        ctx.beginPath();
        ctx.arc(d.x, d.y, DOT_R, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(243,243,243,${alpha})`;
        ctx.fill();
      }

      if (progress < 1) {
        requestAnimationFrame(frame);
      } else if (!done) {
        done = true;
        setTimeout(dismiss, HOLD_DURATION);
      }
    }

    requestAnimationFrame(frame);
  }

  function dismiss() {
    const splash = document.getElementById('splashScreen');
    if (splash) splash.classList.add('hidden');
    if (typeof window.onSplashDone === 'function') window.onSplashDone();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
