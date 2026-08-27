/* Gate Board page script — rail scrollspy + jumps + keyboard, measured anchor
   offsets, expand/collapse-all. Extracted from the owner-approved reference
   mockup (gate-board-reference.html) with three generalizations: chapter ids
   derive from the rail chips at runtime, number keys cover 1..9 bounded by the
   derived chapter count, and Home/End jump to the first/last derived chapter.
   Ships standalone; render.mjs inlines it into every artifact. */
(function(){
  document.documentElement.classList.add('js');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ids = Array.prototype.map.call(document.querySelectorAll('.nav__chip'), function(a){ return a.getAttribute('data-sec'); });
  var track = document.getElementById('navtrack');
  var chips = {};
  document.querySelectorAll('.nav__chip').forEach(function(a){
    chips[a.getAttribute('data-sec')] = a;
  });

  function setLive(id){
    ids.forEach(function(k){
      var c = chips[k];
      if (!c) return;
      var on = k === id;
      c.classList.toggle('is-live', on);
      if (on){
        c.setAttribute('aria-current', 'true');
        /* auto-center only while the rail actually overflows — once it has
           wrapped to two rows on phones there is nothing to scroll */
        if (track && track.scrollWidth > track.clientWidth + 1){
          var target = c.offsetLeft - (track.clientWidth - c.offsetWidth) / 2;
          if (track.scrollTo) track.scrollTo({ left: target, behavior: reduce ? 'auto' : 'smooth' });
          else track.scrollLeft = target;
        }
      } else {
        c.removeAttribute('aria-current');
      }
    });
  }

  /* the rail can wrap to extra rows on narrow screens — keep every anchor
     target clear of the sticky rail by measuring its real height (the CSS
     scroll-margin values remain the no-JS fallback) */
  var nav = document.querySelector('.nav');
  function syncOffset(){
    if (!nav) return;
    var h = nav.offsetHeight + 10;
    document.querySelectorAll('section[id]').forEach(function(s){
      s.style.scrollMarginTop = h + 'px';
    });
  }
  syncOffset();
  window.addEventListener('resize', syncOffset);
  if (document.fonts && document.fonts.ready && document.fonts.ready.then){
    /* the swapped-in faces reflow the text, changing scrollHeight too — so the
       font-load path re-measures the rail AND re-samples the end state (the
       tick function is hoisted; fonts.ready resolves long after init) */
    document.fonts.ready.then(function(){ syncOffset(); onEndScroll(); });
  }

  /* scrollspy — a thin band around the viewport's middle decides the chapter.
     THREE tracked signals drive the live chip: observerId (written ONLY by
     the observer callback), atEnd (computed by the shared end-state helper —
     sampled once at startup and re-sampled by the rAF-throttled tick below on
     scroll AND on the layout-change paths that move the document end without
     one), and navId (armed by jump(); release rule pinned below).
     applyLive() recomputes the selection from all three, so releasing the end
     override restores the observer's chapter WITHOUT a fresh observer event —
     scrolling up from the end may produce none, because the section above the
     final one can be intersecting the band the whole time. */
  var observerId = null;
  var atEnd = false;
  /* navId — the navigation override. Armed by jump() (chip clicks, 1..9 keys,
     Home/End, the ask-strip anchor), it beats the observer/atEnd selection so
     the first scroll tick after a jump can never flip the requested chip back
     to a stale observerId — and a short destination section that never fires
     an observer callback keeps its requested chip. The PINNED RELEASE RULE —
     navId is cleared ONLY by:
       (a) the observer reporting the DESTINATION itself intersecting
           (entry.target.id === navId — the jump landed), or
       (b) an explicit user input — wheel / touchstart / pointerdown / a
           scroll-key keydown. Programmatic smooth scroll fires none of
           these, so a jump can never release itself mid-flight, or
       (c) a new jump() replacing it.
     A merely-intersecting NON-destination entry must NOT release: the
     chapters the band sweeps through during a smooth jump are exactly the
     stale picks the override exists to beat — a short destination would
     otherwise lose its highlight to whatever chapter the band last crossed.
     While navId is held, the observer callback and the scroll tick both
     render navId; atEnd still wins at the document end as today (the
     selection rule is unchanged — a jump that lands at the document end
     targets the last chapter, so the two picks agree there, and the user's
     next real scroll at the end releases the override, handing atEnd the
     rail). Held, not stuck: the user's next real scroll releases it. */
  var navId = null;
  function applyLive(){
    var id = navId !== null ? navId : atEnd ? ids[ids.length - 1] : observerId;
    if (id) setLive(id); /* no signal yet (initial callback, nothing in the band) keeps the markup's Top state */
  }
  /* release (b) — a real user input hands control back to the observer, and
     the release itself re-renders from the current observerId/atEnd: a
     mid-document scroll after the release may neither flip atEnd nor cross an
     observer threshold (the live section is ALREADY intersecting the band, so
     the observer fires nothing new), and waiting for the next signal would
     leave the jump's stale chip lit indefinitely. A pointerdown that begins a
     NEW chip click repaints again the moment jump() re-arms in the same
     gesture, so the destination chip still lands. */
  function releaseNav(){
    if (navId === null) return;
    navId = null;
    applyLive();
  }
  ['wheel', 'touchstart', 'pointerdown'].forEach(function(type){
    window.addEventListener(type, releaseNav, { passive: true });
  });
  /* the page-scrolling keys only — Home/End and 1..9 are jump keys here (they
     route through jump(), which replaces the override per release rule (c)) */
  var scrollKeys = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', ' '];
  window.addEventListener('keydown', function(e){
    if (scrollKeys.indexOf(e.key) !== -1) releaseNav();
  }, { passive: true });
  if ('IntersectionObserver' in window){
    var spy = new IntersectionObserver(function(entries){
      var arrived = false;
      entries.forEach(function(e){
        if (e.isIntersecting){
          observerId = e.target.id;
          if (e.target.id === navId) arrived = true;
        }
      });
      if (arrived) navId = null; /* release (a): the DESTINATION itself reported in — the jump landed */
      applyLive();
    }, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });
    ids.forEach(function(id){
      var s = document.getElementById(id);
      if (s) spy.observe(s);
    });
  }

  /* end-of-document: the observer's mid-viewport band (-40%/-55%) never fires
     for a final section shorter than ~55vh, so the last rail chip could stay
     stale after a jump to the ask. When the viewport bottom reaches the
     document end, the LAST derived chapter is live (passive scroll listener,
     rAF-throttled; the observer keeps deciding everywhere else). The tick
     applies only on an atEnd EDGE — entering the end forces the last chip,
     leaving it restores the observer's pick — so a mid-document click's
     immediate feedback is never stomped by a tick re-asserting an observerId
     the observer has not caught up to yet. */
  /* ONE end-state computation, shared by the scroll tick AND the startup
     sample below — the two must never drift */
  function endState(){
    return ids.length > 0
      && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
  }
  var endTick = false;
  function onEndScroll(){
    if (endTick) return;
    endTick = true;
    requestAnimationFrame(function(){
      endTick = false;
      var nowEnd = endState();
      if (nowEnd !== atEnd){
        atEnd = nowEnd;
        applyLive();
      }
    });
  }
  window.addEventListener('scroll', onEndScroll, { passive: true });
  /* layout changes move the document end WITHOUT a scroll event: a window
     resize, a <details> drawer toggling (Expand/Collapse All included), and a
     late font load all change scrollHeight while scrollY stays put — on a
     short page atEnd went stale until the next real scroll. Every such path
     rides the SAME rAF-throttled tick (edge-applied, so mid-document repaints
     never fire): resize here, the document-level 'toggle' listener (capture:
     true — toggle does not bubble in older engines, so a bubble listener would
     miss the drawers), setAll() below for the expand/collapse-all buttons, and
     the fonts.ready hook up top. */
  window.addEventListener('resize', onEndScroll);
  document.addEventListener('toggle', onEndScroll, { capture: true });
  /* startup sample: a document that already fits the viewport fires NO scroll
     event, ever — atEnd would stay false and the markup's Top chip would sit
     stale over an on-screen ask. Sample the end state once at initialization
     (the script runs at the end of body, after layout) and apply. */
  atEnd = endState();
  applyLive();

  /* ONE jump helper — EVERY navigation (rail chip click, 1..9 keys, Home/End,
     the ask-strip anchor) routes through here: it clears atEnd (leaving the
     end must not reapply stale end state), arms navId, and reapplies the
     selection rule. scroll === false skips scrollIntoView so a native anchor
     click keeps its default navigation (the URL hash stays deep-linkable). */
  function jump(id, scroll){
    var s = document.getElementById(id);
    if (!s) return;
    atEnd = false;
    navId = id;
    if (scroll !== false) s.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    applyLive();
  }

  /* immediate feedback on click; the observer confirms on arrival. Every
     in-page anchor targeting a derived chapter routes through jump() — the
     rail chips and the ask-strip "Jump to the ask" button alike. */
  document.querySelectorAll('a[href^="#"]').forEach(function(a){
    var k = a.getAttribute('href').slice(1);
    if (!chips[k]) return;
    a.addEventListener('click', function(){ jump(k, false); });
  });

  /* number keys 1-9 jump to the first nine chapters; Home/End to first / last */
  window.addEventListener('keydown', function(e){
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    var id = null;
    if (e.key >= '1' && e.key <= '9'){
      var i = parseInt(e.key, 10) - 1;
      if (i < ids.length) id = ids[i];
    }
    else if (e.key === 'Home') id = ids[0];
    else if (e.key === 'End') id = ids[ids.length - 1];
    if (!id) return;
    e.preventDefault();
    jump(id);
  });

  /* expand / collapse every drawer on the page — then re-sample the end state:
     the bulk mutation changes scrollHeight with no scroll event (the per-
     drawer 'toggle' events also fire, but a direct call here is synchronous-
     ordering-proof and costs one shared rAF either way) */
  var exp = document.getElementById('exp-all');
  var col = document.getElementById('col-all');
  function setAll(open){
    document.querySelectorAll('details').forEach(function(d){ d.open = open; });
    onEndScroll();
  }
  if (exp) exp.addEventListener('click', function(){ setAll(true); });
  if (col) col.addEventListener('click', function(){ setAll(false); });
})();
