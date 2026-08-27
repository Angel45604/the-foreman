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
    document.fonts.ready.then(syncOffset);
  }

  /* scrollspy — a thin band around the viewport's middle decides the chapter.
     TWO tracked signals drive the live chip: observerId (written ONLY by the
     observer callback) and atEnd (owned by the rAF-throttled scroll tick
     below). applyLive() recomputes the selection from both, so releasing the
     end override restores the observer's chapter WITHOUT a fresh observer
     event — scrolling up from the end may produce none, because the section
     above the final one can be intersecting the band the whole time. */
  var observerId = null;
  var atEnd = false;
  function applyLive(){
    var id = atEnd ? ids[ids.length - 1] : observerId;
    if (id) setLive(id); /* no signal yet (initial callback, nothing in the band) keeps the markup's Top state */
  }
  if ('IntersectionObserver' in window){
    var spy = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if (e.isIntersecting) observerId = e.target.id;
      });
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
  var endTick = false;
  function onEndScroll(){
    if (endTick) return;
    endTick = true;
    requestAnimationFrame(function(){
      endTick = false;
      var nowEnd = ids.length > 0
        && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (nowEnd !== atEnd){
        atEnd = nowEnd;
        applyLive();
      }
    });
  }
  window.addEventListener('scroll', onEndScroll, { passive: true });

  /* immediate feedback on click; the observer confirms on arrival */
  ids.forEach(function(k){
    if (chips[k]) chips[k].addEventListener('click', function(){ setLive(k); });
  });

  function jump(id){
    var s = document.getElementById(id);
    if (!s) return;
    s.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    setLive(id);
  }

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

  /* expand / collapse every drawer on the page */
  var exp = document.getElementById('exp-all');
  var col = document.getElementById('col-all');
  function setAll(open){
    document.querySelectorAll('details').forEach(function(d){ d.open = open; });
  }
  if (exp) exp.addEventListener('click', function(){ setAll(true); });
  if (col) col.addEventListener('click', function(){ setAll(false); });
})();
