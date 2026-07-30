(function(){
  var slides=[].slice.call(document.querySelectorAll('.slide')),n=slides.length,i=0;
  var bar=document.getElementById('bar'),pg=document.getElementById('pg'),dots=document.getElementById('dots'),prev=document.getElementById('prev'),next=document.getElementById('next');
  slides.forEach(function(_,k){var b=document.createElement('button');b.className='dot'+(k===0?' on':'');b.addEventListener('click',function(){go(k)});dots.appendChild(b)});
  var de=[].slice.call(dots.children);

  // ---- chapters navigator -----------------------------------------------
  // Build a top-left index that jumps across slides, grouping consecutive
  // slides that share a data-section into named accordion groups. Mirrors the
  // dots pattern: #chapters is an empty container the engine fills.
  var toctgl=document.getElementById('toctgl'),chapters=document.getElementById('chapters');
  var rows=[],groups=[],slideGroup=[],navItems=[]; // rows[k]=row el; groups=[{el}]; slideGroup[k]=group index or -1; navItems=focusable entries (headers+rows) in document order
  if(n>=2&&chapters){
    var hasSection=slides.some(function(s){return s.getAttribute('data-section')});
    var curGroup=null,curName=null;
    slides.forEach(function(s,k){
      var heading=(s.querySelector('h2')||{}).textContent||'';
      var kickEl=s.querySelector('.kicker'),kick=kickEl?(kickEl.textContent||'').trim():'';
      var section=s.getAttribute('data-section');
      var row=document.createElement('button');row.classList.add('chaprow');row.setAttribute('role','menuitem');
      var lab=document.createElement('span');lab.classList.add('chaplabel');lab.textContent=heading;row.appendChild(lab);
      if(kick){var ke=document.createElement('span');ke.classList.add('chapkick');ke.textContent=kick;row.appendChild(ke);}
      (function(idx){row.addEventListener('click',function(){go(idx)});})(k);
      rows[k]=row;
      if(hasSection&&section){
        // continue the current run only if it's the SAME consecutive section
        if(!curGroup||curName!==section){
          var g=document.createElement('div');g.classList.add('chapgroup');
          var head=document.createElement('button');head.classList.add('chaphead');head.textContent=section;
          (function(gel){head.addEventListener('click',function(){gel.classList.toggle('open')});})(g);
          g.appendChild(head);chapters.appendChild(g);navItems.push(head);
          curGroup=g;curName=section;groups.push({el:g});
        }
        curGroup.appendChild(row);slideGroup[k]=groups.length-1;navItems.push(row);
      }else{
        // standalone (null-section) slide, or flat-list mode: a top-level row
        chapters.appendChild(row);slideGroup[k]=-1;curGroup=null;curName=null;navItems.push(row);
      }
    });
  }else if(chapters){
    chapters.style.display='none';if(toctgl)toctgl.style.display='none';
  }

  function renderChapters(){
    rows.forEach(function(r,k){if(r)r.classList.toggle('on',k===i)});
    var ai=slideGroup[i];if(ai!=null&&ai>=0&&groups[ai])groups[ai].el.classList.add('open');
  }
  function render(){slides.forEach(function(s,k){s.classList.toggle('on',k===i)});de.forEach(function(d,k){d.classList.toggle('on',k===i)});bar.style.width=(n<=1?0:i/(n-1)*100)+'%';pg.textContent=String(i+1).padStart(2,'0')+' / '+String(n).padStart(2,'0');prev.disabled=i===0;next.disabled=i===n-1;renderChapters()}
  function go(k){i=Math.max(0,Math.min(n-1,k));render()}
  prev.addEventListener('click',function(){go(i-1)});next.addEventListener('click',function(){go(i+1)});

  // panel open/close state, mirrored onto #toctgl[aria-expanded]. Opening moves
  // focus into the panel (keyboard-operable); closing leaves focus where asked.
  function setExpanded(v){if(toctgl&&toctgl.setAttribute)toctgl.setAttribute('aria-expanded',v?'true':'false')}
  function panelOpen(){return!!(chapters&&chapters.classList.contains('open'))}
  function openPanel(){if(!chapters)return;chapters.classList.add('open');setExpanded(true);if(navItems[0]&&navItems[0].focus)navItems[0].focus()}
  function closePanel(refocus){if(!chapters)return;chapters.classList.remove('open');setExpanded(false);if(refocus&&toctgl&&toctgl.focus)toctgl.focus()}
  setExpanded(false); // reflect the initial (closed) state
  // toggle button pins the panel open; Escape + outside-click close it.
  if(toctgl&&chapters){
    toctgl.addEventListener('click',function(){if(panelOpen())closePanel(false);else openPanel()});
    document.addEventListener('click',function(e){var t=e&&e.target;if(t===toctgl||t===chapters)return;if(t&&t.closest&&(t.closest('#chapters')||t.closest('#toctgl')))return;closePanel(false)});
  }

  function ctrl(t){if(!t)return false;if(t.isContentEditable)return true;var tag=t.tagName;if(tag==='BUTTON'||tag==='A'||tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA')return true;return t.getAttribute&&t.getAttribute('role')==='button'}
  function inPanel(t){return navItems.indexOf(t)>=0} // focus is on a chapter entry
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'){closePanel(true);return}
    // roving focus inside the open panel — and swallow the key so the GLOBAL
    // slide-nav below does NOT also fire (Arrow would otherwise change slides).
    if(panelOpen()&&inPanel(e.target)){
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){
        e.preventDefault();
        var at=navItems.indexOf(e.target),to=at+(e.key==='ArrowDown'?1:-1);
        if(to>=0&&to<navItems.length&&navItems[to].focus)navItems[to].focus();
        return;
      }
      if(e.key==='ArrowLeft'||e.key==='ArrowRight'||e.key==='Home'||e.key==='End'){e.preventDefault();return}
    }
    if(e.key===' '&&ctrl(e.target))return;
    if(e.key==='ArrowRight'||e.key===' '){e.preventDefault();go(i+1)}else if(e.key==='ArrowLeft'){e.preventDefault();go(i-1)}else if(e.key==='Home'){e.preventDefault();go(0)}else if(e.key==='End'){e.preventDefault();go(n-1)}
  });
  render();
})();
