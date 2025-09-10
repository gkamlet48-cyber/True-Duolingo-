
/* LinguaSprint - minimal Duolingo-like PWA
   Features: courses, lessons, multiple-choice & typing, XP, streak, spaced review.
   Data persistence via localStorage. */
const $ = (sel, el=document) => el.querySelector(sel);
const $$ = (sel, el=document) => [...el.querySelectorAll(sel)];

const state = {
  data: null,
  course: localStorage.getItem('course') || 'es',
  xp: parseInt(localStorage.getItem('xp')||'0',10),
  streak: parseInt(localStorage.getItem('streak')||'0',10),
  lastDay: localStorage.getItem('lastDay') || null,
  srs: JSON.parse(localStorage.getItem('srs') || '{}') // itemId -> {due, interval}
};

const save = () => {
  localStorage.setItem('course', state.course);
  localStorage.setItem('xp', state.xp);
  localStorage.setItem('streak', state.streak);
  localStorage.setItem('lastDay', state.lastDay);
  localStorage.setItem('srs', JSON.stringify(state.srs));
  updateStats();
};

function todayKey(){
  const d = new Date();
  return d.toISOString().slice(0,10);
}

function updateStreak(){
  const t = todayKey();
  if(state.lastDay === t) return; // already counted today
  if(!state.lastDay){
    state.streak = 1;
  } else {
    const prev = new Date(state.lastDay);
    const cur = new Date(t);
    const diff = (cur - prev)/(1000*60*60*24);
    if(diff === 1) state.streak += 1;
    else state.streak = 1;
  }
  state.lastDay = t;
}

function updateStats(){
  $('#xp').textContent = `⭐ ${state.xp}`;
  $('#streak').textContent = `🔥 ${state.streak}`;
}

async function loadData(){
  const res = await fetch('./data/lessons.json');
  state.data = await res.json();
}

function renderHome(){
  const tpl = $('#tpl-home').content.cloneNode(true);
  const coursesEl = tpl.querySelector('#courses');
  state.data.courses.forEach(c=>{
    const div = document.createElement('div');
    div.className = 'tile';
    div.innerHTML = `<h4>${c.flag} ${c.name}</h4>
      <div class="badge">${c.units.length} units</div>
      <div style="margin-top:8px"><button class="ghost" data-course="${c.id}">Switch</button>
      <button class="primary" data-open="${c.id}">Open</button></div>`;
    coursesEl.appendChild(div);
  });
  const unitsEl = tpl.querySelector('#units');
  const course = state.data.courses.find(c=>c.id===state.course) || state.data.courses[0];
  course.units.forEach(u=>{
    const div = document.createElement('div');
    const done = progressForUnit(u).done;
    div.className='tile';
    div.innerHTML = `<h4>${u.name}</h4>
      <div class="badge">${done}/${u.items.length} complete</div>
      <div style="margin-top:8px"><button class="primary" data-start="${u.id}">Start</button>
      <button class="ghost" data-review="${u.id}">Review</button></div>`;
    unitsEl.appendChild(div);
  });
  const view = $('#view');
  view.innerHTML = '';
  view.appendChild(tpl);
  // handlers
  $$('button[data-course]').forEach(b=>b.onclick = ()=>{ state.course = b.dataset.course; save(); renderHome(); });
  $$('button[data-open]').forEach(b=>b.onclick = ()=>{ state.course = b.dataset.open; save(); renderHome(); });
  $$('button[data-start]').forEach(b=>b.onclick = ()=> startLesson(b.dataset.start));
  $$('button[data-review]').forEach(b=>b.onclick = ()=> startLesson(b.dataset.review, true));
}

function progressForUnit(unit){
  let done = 0;
  unit.items.forEach(it=>{
    const s = state.srs[it.id];
    if(s && s.interval>=3) done++; // arbitrary "mastered" threshold
  });
  return {done};
}

function pickDueItems(unit){
  const now = Date.now();
  // if review flag, pick only items that are due
  const due = unit.items.filter(it=>{
    const s = state.srs[it.id];
    return !s || (s.due && s.due <= now);
  });
  return due.length ? due : unit.items; // fallback to all
}

function startLesson(unitId, review=false){
  const course = state.data.courses.find(c=>c.id===state.course);
  const unit = course.units.find(u=>u.id===unitId);
  const items = review ? pickDueItems(unit) : [...unit.items];
  let idx = 0, correct = 0;

  const tpl = $('#tpl-lesson').content.cloneNode(true);
  const view = $('#view'); view.innerHTML=''; view.appendChild(tpl);
  const card = $('#card');
  const progress = $('#lessonProgress');
  const checkBtn = $('#checkBtn');
  const skipBtn = $('#skipBtn');

  function renderItem(){
    const it = items[idx];
    progress.style.width = `${(idx/items.length)*100}%`;
    card.innerHTML = '';
    const q = document.createElement('div');
    q.innerHTML = `<h3 style="margin:0 0 8px">${it.front}</h3>`;
    card.appendChild(q);

    if(it.type==='mc'){
      const opts = document.createElement('div'); opts.className='options';
      it.options.forEach(opt=>{
        const o = document.createElement('label'); o.className='option';
        o.innerHTML = `<span>${opt}</span><input type="radio" name="mc" value="${opt}">`;
        opts.appendChild(o);
      });
      card.appendChild(opts);
    } else if(it.type==='type'){
      const inp = document.createElement('input'); inp.type='text'; inp.placeholder='Type your answer…'; inp.autocapitalize='off'; inp.autocomplete='off'; inp.spellcheck=false;
      card.appendChild(inp);
    }
  }

  function normalize(s){ return s.trim().toLowerCase(); }

  function scheduleSRS(itemId, wasCorrect){
    const now = Date.now();
    const rec = state.srs[itemId] || {interval:0, due:now};
    if(wasCorrect){
      rec.interval = Math.min(rec.interval + 1, 6);
    } else {
      rec.interval = Math.max(rec.interval - 1, 0);
    }
    const intervals = [0, 12, 24, 48, 96, 168, 336]; // hours (spaced repetition buckets)
    rec.due = now + intervals[rec.interval]*60*60*1000;
    state.srs[itemId] = rec;
  }

  function check(){
    const it = items[idx];
    let ok = false;
    if(it.type==='mc'){
      const sel = $('input[name="mc"]:checked', card);
      if(!sel){ alert('Choose an option'); return; }
      ok = normalize(sel.value) === normalize(it.answer);
    } else {
      const inp = $('input[type="text"]', card);
      if(!inp){ return; }
      ok = normalize(inp.value) === normalize(it.answer);
    }
    scheduleSRS(it.id, ok);
    if(ok){ correct++; toast('Correct! ⭐ +'+it.xp); state.xp += it.xp; }
    else { toast('Not quite. Keep going!'); }
    idx++;
    if(idx>=items.length){
      progress.style.width = '100%';
      updateStreak();
      save();
      setTimeout(()=>{
        view.innerHTML = `<section class="block card" style="text-align:center">
          <h2>Lesson complete</h2>
          <p>You got ${correct}/${items.length} correct.</p>
          <p>🔥 Streak: ${state.streak} &nbsp; ⭐ XP: ${state.xp}</p>
          <button class="primary" id="homeBtn">Back to Home</button>
        </section>`;
        $('#homeBtn').onclick = renderHome;
      }, 300);
    } else {
      save();
      renderItem();
    }
  }

  checkBtn.onclick = check;
  skipBtn.onclick = ()=>{ idx++; if(idx>=items.length){ check(); } else renderItem(); };
  renderItem();
}

function renderProfile(){
  const tpl = $('#tpl-profile').content.cloneNode(true);
  tpl.querySelector('#pfStreak').textContent = state.streak;
  tpl.querySelector('#pfXP').textContent = state.xp;
  const course = state.data.courses.find(c=>c.id===state.course);
  tpl.querySelector('#pfCourse').textContent = course ? course.name : '–';
  const view = $('#view'); view.innerHTML=''; view.appendChild(tpl);
  tpl.querySelector('#resetBtn').onclick = ()=>{
    if(confirm('Reset all progress?')){
      localStorage.clear();
      location.reload();
    }
  };
}

function router(tab){
  $$('.tab').forEach(b=>b.classList.remove('active'));
  $(`.tab[data-tab="${tab}"]`).classList.add('active');
  if(tab==='learn') renderHome();
  if(tab==='review') renderHome(); // same home, but user can pick "Review"
  if(tab==='profile') renderProfile();
}

function toast(msg){
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, {position:'fixed',left:'50%',bottom:'90px',transform:'translateX(-50%)',background:'#1f2937',padding:'10px 14px',borderRadius:'12px',border:'1px solid rgba(255,255,255,.12)',zIndex:9});
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),1200);
}

// init
(async function init(){
  await loadData();
  updateStats();
  router('learn');
  $$('.tab').forEach(b=> b.onclick = ()=> router(b.dataset.tab));
})();
