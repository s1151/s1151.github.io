'use strict';

/* =========================================================
   pho.design — flat-lay book carousel
   ---------------------------------------------------------
   PAGE_IMAGES is the single source of truth: one image per
   page, in reading order. The FIRST image is treated as the
   front cover and the LAST as the back cover — both shown as
   a single centred page. Everything in between is paired into
   two-page spreads automatically.

   Turn behaviour:
     - spread <-> spread : instant swap, no animation, so the
       reader can click through at any pace.
     - cover  <-> spread : the book's height morphs while the
       new content crossfades in over the old. Both run for
       the same duration (COVER_MS / --cover-ms in style.css).

   The layout assumes A-series LANDSCAPE pages (297 × 210 mm,
   ratio ≈ 1.414:1). Images always render at their intrinsic
   ratio (never stretched); any size mismatch is cropped by
   overflow at the outer page edges.

   Zoom (see the zoom section below):
     - scroll wheel zooms the book 1×–4×, anchored at the cursor;
       zooming out progressively recentres the book so it sits
       perfectly centred again at maximum zoom-out;
     - on touch devices, two-finger pinch zooms (and pans).
   ========================================================= */

const PAGE_IMAGES = [
  'jpg/previewjpg1.jpg',
  'jpg/previewjpg2.jpg',
  'jpg/previewjpg3.jpg',
  'jpg/previewjpg4.jpg',
  'jpg/previewjpg5.jpg',
  'jpg/previewjpg6.jpg',
  'jpg/previewjpg7.jpg',
  'jpg/previewjpg8.jpg',
  'jpg/previewjpg9.jpg',
  'jpg/previewjpg10.jpg',
  'jpg/previewjpg11.jpg',
  'jpg/previewjpg12.jpg',
  'jpg/previewjpg13.jpg',
  'jpg/previewjpg14.jpg',
  'jpg/previewjpg15.jpg',
  'jpg/previewjpg16.jpg',
  'jpg/previewjpg17.jpg',
  'jpg/previewjpg18.jpg',
  'jpg/previewjpg19.jpg'
];

/* ---------------------------------------------------------
   Spread model
   Builds the reading order from PAGE_IMAGES:
     - first page            -> front cover (single, centred)
     - last page             -> back cover  (single, centred)
     - everything in between -> two-page spreads
   Each spread is { left, right, single } where left/right are
   PAGE_IMAGES indices and null means bare paper (no image).
   --------------------------------------------------------- */
function buildSpreads(images) {
  const last = images.length - 1;

  // A lone page acts as both covers at once.
  if (last === 0) return [{ left: null, right: 0, single: true }];

  const spreads = [{ left: null, right: 0, single: true }]; // front cover

  for (let i = 1; i < last; i += 2) {
    spreads.push({
      left:   i,
      right:  i + 1 < last ? i + 1 : null,
      single: false,
    });
  }

  spreads.push({ left: last, right: null, single: true });  // back cover
  return spreads;
}

const SPREADS = buildSpreads(PAGE_IMAGES);

/* ---------------------------------------------------------
   State & DOM references
   --------------------------------------------------------- */
const COVER_MS = 500;  // cover morph + crossfade — keep in sync with --cover-ms in style.css

const book      = document.getElementById('book');
const stage     = document.querySelector('.stage');
const layers    = [document.getElementById('spreadA'), document.getElementById('spreadB')];
const prevBtn   = document.getElementById('prevBtn');
const nextBtn   = document.getElementById('nextBtn');
const indicator = document.getElementById('pageIndicator');
const pageMenu  = document.getElementById('pageMenu');

let currentSpread = 0;                                // index into SPREADS
const totalSpreads = SPREADS.length;
let activeLayer = 0;                                  // which spread layer is on top
let swapTimer   = null;                               // pending crossfade cleanup

/* ---------------------------------------------------------
   Paint one page slot. A null index leaves bare paper.
   --------------------------------------------------------- */
function setPage(pageEl, pageIndex) {
  const img = pageEl.querySelector('img');
  const hasImage = pageIndex !== null;

  pageEl.classList.toggle('is-blank', !hasImage);

  if (hasImage) {
    img.src = PAGE_IMAGES[pageIndex];
    img.alt = `Portfolio page ${pageIndex + 1}`;
  } else {
    img.removeAttribute('src');
    img.alt = '';
  }
}

/* ---------------------------------------------------------
   Paint a spread into a given layer
   --------------------------------------------------------- */
function renderSpread(layer, spread) {
  // Single-page spreads (covers) hide the unused half entirely.
  layer.classList.toggle('single-left',  spread.single && spread.left  !== null);
  layer.classList.toggle('single-right', spread.single && spread.right !== null);

  setPage(layer.querySelector('.page-left'),  spread.left);
  setPage(layer.querySelector('.page-right'), spread.right);
}

/* ---------------------------------------------------------
   Footer indicator + arrow disabled states
   --------------------------------------------------------- */
function spreadLabel(spread) {
  const total = PAGE_IMAGES.length;

  if (spread.single)         return `Page ${(spread.left ?? spread.right) + 1} of ${total}`;
  if (spread.right === null) return `Page ${spread.left + 1} of ${total}`;
  return `Pages ${spread.left + 1}\u2013${spread.right + 1} of ${total}`;
}

function updateChrome() {
  indicator.textContent = spreadLabel(SPREADS[currentSpread]);

  // Clamp navigation at the covers (no wrap-around)
  prevBtn.disabled = currentSpread === 0;
  nextBtn.disabled = currentSpread === totalSpreads - 1;

  // Highlight the current spread in the jump menu
  menuButtons.forEach((btn, i) => btn.classList.toggle('is-current', i === currentSpread));
}

/* ---------------------------------------------------------
   If a cover crossfade is still in flight when a new turn
   starts, settle it instantly: hide the old bottom layer and
   adopt the incoming one. (Its fade-in simply continues.)
   --------------------------------------------------------- */
function settleLayers() {
  if (swapTimer === null) return;
  clearTimeout(swapTimer);
  swapTimer = null;

  const bottom = layers[activeLayer];
  bottom.classList.remove('is-visible', 'is-top', 'is-leaving');
  bottom.setAttribute('aria-hidden', 'true');
  activeLayer = 1 - activeLayer;
}

/* ---------------------------------------------------------
   Turn to a spread.
   Spread <-> spread turns swap instantly in the visible
   layer — no lockout, readers can click through at any pace.
   Turns crossing a cover boundary morph the book's height
   AND crossfade the new spread in over the old; both run for
   COVER_MS. CSS retargets the morph smoothly if the reader
   reverses mid-animation.
   --------------------------------------------------------- */
function goToSpread(target) {
  if (target < 0 || target >= totalSpreads || target === currentSpread) return;

  settleLayers();

  const crossingCover = SPREADS[currentSpread].single !== SPREADS[target].single;
  currentSpread = target;
  updateChrome();

  // Spread <-> spread: instant swap, no animation.
  if (!crossingCover) {
    renderSpread(layers[activeLayer], SPREADS[target]);
    return;
  }

  // Cover boundary: render the new spread into the hidden layer,
  // start the height morph, then crossfade — the incoming layer
  // fades in over the full duration while the outgoing one fades
  // out beneath it in the second half. Symmetric in both directions.
  const incoming = layers[1 - activeLayer];
  const outgoing = layers[activeLayer];

  renderSpread(incoming, SPREADS[target]);
  book.classList.toggle('is-single', SPREADS[target].single);

  incoming.classList.add('is-top');
  incoming.setAttribute('aria-hidden', 'false');
  void incoming.offsetWidth;          // flush styles so opacity starts at 0
  incoming.classList.add('is-visible');

  outgoing.classList.add('is-leaving');
  outgoing.classList.remove('is-visible', 'is-top');
  outgoing.setAttribute('aria-hidden', 'true');

  swapTimer = setTimeout(() => {
    outgoing.classList.remove('is-leaving');
    activeLayer = 1 - activeLayer;
    swapTimer = null;
  }, COVER_MS);
}

/* ---------------------------------------------------------
   Input: arrows, page clicks, keyboard, and a light swipe
   --------------------------------------------------------- */
prevBtn.addEventListener('click', () => goToSpread(currentSpread - 1));
nextBtn.addEventListener('click', () => goToSpread(currentSpread + 1));

// Clicking a page turns toward it: left page = back, right page = forward.
book.addEventListener('click', (event) => {
  const page = event.target.closest('.page');
  if (!page) return;
  goToSpread(currentSpread + (page.classList.contains('page-left') ? -1 : 1));
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft')  goToSpread(currentSpread - 1);
  if (event.key === 'ArrowRight') goToSpread(currentSpread + 1);
});

// Minimal swipe support (horizontal flicks only)
let touchStartX = null;

document.addEventListener('touchstart', (event) => {
  if (event.touches.length === 1) touchStartX = event.touches[0].clientX;
}, { passive: true });

document.addEventListener('touchend', (event) => {
  if (touchStartX === null) return;
  const deltaX = event.changedTouches[0].clientX - touchStartX;
  touchStartX = null;

  if (Math.abs(deltaX) < 40) return;             // ignore tiny drifts
  goToSpread(currentSpread + (deltaX < 0 ? 1 : -1));
}, { passive: true });

/* ---------------------------------------------------------
   Zoom — smooth cursor-anchored wheel zoom + pinch
   State is split into a TARGET (where the input wants to be)
   and a RENDER state that lerps toward it every animation
   frame, so wheel ticks feel continuous (Figma / Bambu style).
   Transform mapping (top-left origin, see style.css):
   client = s·p + t. Scale is bounded to [1, MAX_ZOOM].
   --------------------------------------------------------- */
const MAX_ZOOM = 4;
const ZOOM_EASE = 0.10;           // per-frame lerp toward the target
const CENTRE_WINDOW = 0.01;       // below 1.35×, pan eases back to centre

let targetScale = 1, targetX = 0, targetY = 0;
let renderScale = 1, renderX = 0, renderY = 0;
let zoomRaf = null;

function renderZoom() {
  // At rest the transform is cleared entirely (crisper rendering).
  book.style.transform = (renderScale === 1 && renderX === 0 && renderY === 0)
    ? ''
    : `translate3d(${renderX}px, ${renderY}px, 0) scale(${renderScale})`;
}

function zoomFrame() {
  const ds = targetScale - renderScale;
  const dx = targetX - renderX;
  const dy = targetY - renderY;

  if (Math.abs(ds) < 0.001 && Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) {
    renderScale = targetScale;
    renderX = targetX;
    renderY = targetY;
    renderZoom();
    zoomRaf = null;
    return;
  }

  renderScale += ds * ZOOM_EASE;
  renderX     += dx * ZOOM_EASE;
  renderY     += dy * ZOOM_EASE;
  renderZoom();
  zoomRaf = requestAnimationFrame(zoomFrame);
}

function kickZoom() {
  if (zoomRaf === null) zoomRaf = requestAnimationFrame(zoomFrame);
}

/* The book's untransformed rect in client coordinates.
   offsetLeft/Top/Width/Height ignore transforms, so this stays
   accurate while zoomed. (.stage is the book's offsetParent.) */
function bookNaturalRect() {
  const stageRect = stage.getBoundingClientRect();
  return {
    left:   stageRect.left + book.offsetLeft,
    top:    stageRect.top  + book.offsetTop,
    width:  book.offsetWidth,
    height: book.offsetHeight,
  };
}

/* How far the book's edges may pass the viewport frame, as a
   fraction of the viewport per axis. Gaps are allowed (deep corner
   zooms stay pinned instead of fighting the clamp), but the bound
   is finite so the page can never be lost off-screen. */
const PAN_MARGIN = 0.25;

/* Clamp one pan axis with that margin around the no-gap boundary:
     - scaled book LARGER than the viewport -> edges may enter the
       frame by at most the margin;
     - scaled book SMALLER -> edges may leave the frame by at most
       the margin. */
function clampPanAxis(t, pos, scaledSize, viewportSize) {
  const g = viewportSize * PAN_MARGIN;
  const lo = (scaledSize >= viewportSize ? viewportSize - pos - scaledSize : -pos) - g;
  const hi = (scaledSize >= viewportSize ? -pos : viewportSize - pos - scaledSize) + g;
  return Math.min(hi, Math.max(lo, t));
}

/* Boundary rules applied to a candidate transform: padded viewport
   containment only. (Recentring is handled direction-aware in
   zoomGesture — see below — so it never fights the focal pin.) */
function clampPan(tx, ty, s, rect) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  return {
    tx: clampPanAxis(tx, rect.left, rect.width  * s, vw),
    ty: clampPanAxis(ty, rect.top,  rect.height * s, vh),
  };
}

/* Wheel zoom runs in "gestures": the book-space point under the
   cursor at the FIRST tick of a scroll is captured and pinned to
   that same screen point until the gesture concludes, so the lerp
   (and the cursor's position relative to the moving book) can't
   drift the focal point mid-scroll. A short grace period after
   the last tick ends the gesture; the next scroll picks a fresh
   anchor wherever the cursor is then. */
const WHEEL_GRACE_MS = 300;

let wheelAnchor = null;   // { x, y, ex, ey, rect } for the active gesture
let wheelTimer  = null;

function zoomGesture(s1) {
  const s0 = targetScale;
  s1 = Math.min(MAX_ZOOM, Math.max(1, s1));
  if (s1 === s0 || wheelAnchor === null) return;

  const a = wheelAnchor;
  const zoomingOut = s1 < s0;

  // Direction flip mid-gesture? Recapture the content point under the
  // locked screen anchor from the CURRENT target transform, so the
  // pin continues from where the book actually is — no jump.
  if (zoomingOut !== a.wasZoomingOut) {
    a.ex = (a.x - a.rect.left - targetX) / targetScale;
    a.ey = (a.y - a.rect.top  - targetY) / targetScale;
    a.wasZoomingOut = zoomingOut;
  }

  // Pin the gesture's book point under the gesture's screen anchor.
  let tx = a.x - a.rect.left - s1 * a.ex;
  let ty = a.y - a.rect.top  - s1 * a.ey;

  // Zoom-IN: pure pinning — a caption under the cursor stays glued
  // to it from the very first tick. Zoom-OUT: recenter gradually so
  // the book settles exactly centred at full zoom-out.
  if (zoomingOut) {
    const centrePull = Math.min(1, (s1 - 1) / CENTRE_WINDOW);
    tx *= centrePull;
    ty *= centrePull;
  }

  const clamped = clampPan(tx, ty, s1, a.rect);

  targetScale = s1;
  targetX = clamped.tx;
  targetY = clamped.ty;
  kickZoom();
}

stage.addEventListener('wheel', (event) => {
  event.preventDefault();

  // First tick of a gesture: capture the anchor (screen point +
  // the book-space content point currently under it).
  if (wheelAnchor === null) {
    const rect = bookNaturalRect();
    wheelAnchor = {
      x: event.clientX,
      y: event.clientY,
      rect,
      ex: (event.clientX - rect.left - targetX) / targetScale,
      ey: (event.clientY - rect.top  - targetY) / targetScale,
    };
  }

  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => {
    wheelAnchor = null;                        // gesture concluded
    wheelTimer = null;
  }, WHEEL_GRACE_MS);

  const unit   = event.deltaMode === 1 ? 16 : 1;   // line mode -> pixels
  const factor = Math.exp(-event.deltaY * unit * 0.0015);
  const s1     = targetScale * factor;

  // First tick of a gesture: capture the anchor (screen point +
  // the book-space content point currently under it).
  if (wheelAnchor === null) {
    const rect = bookNaturalRect();
    wheelAnchor = {
      x: event.clientX,
      y: event.clientY,
      rect,
      ex: (event.clientX - rect.left - targetX) / targetScale,
      ey: (event.clientY - rect.top  - targetY) / targetScale,
      wasZoomingOut: s1 < targetScale,
    };
  }

  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => {
    wheelAnchor = null;                        // gesture concluded
    wheelTimer = null;
  }, WHEEL_GRACE_MS);

  zoomGesture(s1);
}, { passive: false });

/* Pinch zoom — direct 1:1 manipulation (no lerp lag), with free
   two-finger pan via the moving midpoint. */
let pinch = null;

function touchMid(a, b) {
  return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
}

stage.addEventListener('touchstart', (event) => {
  if (event.touches.length !== 2) return;

  touchStartX = null;                          // cancel any swipe-to-turn
  const [a, b] = event.touches;
  const rect = bookNaturalRect();
  const mid = touchMid(a, b);

  pinch = {
    startDist:  Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
    startScale: targetScale,
    rect,
    // Book-space point under the midpoint at gesture start (constant)
    ex: (mid.x - rect.left - targetX) / targetScale,
    ey: (mid.y - rect.top  - targetY) / targetScale,
  };
}, { passive: true });

stage.addEventListener('touchmove', (event) => {
  if (!pinch || event.touches.length !== 2) return;
  event.preventDefault();                      // stop the page pinch-zoom

  const [a, b] = event.touches;
  const mid  = touchMid(a, b);
  const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  const s1 = Math.min(MAX_ZOOM, Math.max(1, pinch.startScale * (dist / pinch.startDist)));

  const pinnedTx = mid.x - pinch.rect.left - s1 * pinch.ex;
  const pinnedTy = mid.y - pinch.rect.top  - s1 * pinch.ey;
  let { tx, ty } = clampPan(pinnedTx, pinnedTy, s1, pinch.rect);
  if (s1 === 1) { tx = 0; ty = 0; }    // pinch-out always lands centred

  // Direct manipulation: render immediately, no lerp.
  targetScale = renderScale = s1;
  targetX = renderX = tx;
  targetY = renderY = ty;
  renderZoom();
}, { passive: false });

stage.addEventListener('touchend', (event) => {
  if (event.touches.length < 2) pinch = null;
});

/* ---------------------------------------------------------
   Page jump menu — one compact button per spread, labelled by
   page number(s). Opens upward from the footer indicator.
   --------------------------------------------------------- */
const menuButtons = SPREADS.map((spread, index) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = (spread.single || spread.right === null)
    ? String((spread.left ?? spread.right) + 1)
    : `${spread.left + 1}\u2013${spread.right + 1}`;

  btn.addEventListener('click', () => {
    closePageMenu();
    goToSpread(index);
  });

  pageMenu.appendChild(btn);
  return btn;
});

let menuOpen = false;

function openPageMenu() {
  menuOpen = true;
  pageMenu.hidden = false;
  indicator.setAttribute('aria-expanded', 'true');
}

function closePageMenu() {
  menuOpen = false;
  pageMenu.hidden = true;
  indicator.setAttribute('aria-expanded', 'false');
}

indicator.addEventListener('click', (event) => {
  event.stopPropagation();
  if (menuOpen) closePageMenu(); else openPageMenu();
});

// Close on any click outside the footer widget, or on Escape.
document.addEventListener('click', (event) => {
  if (menuOpen && !event.target.closest('.page-nav')) closePageMenu();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closePageMenu();
});

/* ---------------------------------------------------------
   Type-to-jump: digits pressed anywhere form a page number.
   Numbers that can't be extended ("2"–"9" in a 19-page book)
   jump instantly; "1" waits briefly in case it becomes 10–19.
   --------------------------------------------------------- */
let typeBuffer = '';
let typeTimer  = null;

function spreadIndexForPage(pageNumber) {
  const index = pageNumber - 1;
  return SPREADS.findIndex((s) => s.left === index || s.right === index);
}

function resetTypeBuffer() {
  clearTimeout(typeTimer);
  typeTimer  = null;
  typeBuffer = '';
  updateChrome();                         // restore the indicator label
}

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (!/^[0-9]$/.test(event.key)) return;

  clearTimeout(typeTimer);
  typeBuffer += event.key;

  const total = PAGE_IMAGES.length;
  const page  = parseInt(typeBuffer, 10);

  if (page < 1 || page > total) {         // no such page — discard
    resetTypeBuffer();
    return;
  }

  indicator.textContent = typeBuffer;     // echo the typed digits

  if (page * 10 > total) {
    goToSpread(spreadIndexForPage(page)); // can't be extended — jump now
    resetTypeBuffer();
  } else {
    typeTimer = setTimeout(() => {        // maybe more digits — wait
      goToSpread(spreadIndexForPage(page));
      resetTypeBuffer();
    }, 800);
  }
});

/* ---------------------------------------------------------
   Init
   --------------------------------------------------------- */
book.classList.toggle('is-single', SPREADS[0].single);
renderSpread(layers[0], SPREADS[0]);
updateChrome();
