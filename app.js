/* =====================================================================
   AppCore - all UI / state / rendering logic, independent of Firebase.
   Talks to the outside world only through the `dataLayer` object passed
   into AppCore.init(dataLayer). This makes it possible to swap in a fake
   dataLayer for testing without touching Firebase at all.

   dataLayer contract (all required):
     onExpenses(cb)      -> cb(array of {id, amount, catId, sub, date, note, createdAt}); returns unsubscribe()
     addExpense(data)    -> Promise
     updateExpense(id,data) -> Promise
     deleteExpense(id)   -> Promise
     onBudget(cb)        -> cb(numberOrNull); returns unsubscribe()
     setBudget(value)    -> Promise
     onConnection(cb)    -> cb({online:boolean, pendingWrites:boolean}); returns unsubscribe()
     signOut()           -> Promise
   ===================================================================== */
window.AppCore = (function(){
"use strict";

const CATEGORIES = [
  {id:'spozywcze',  name:'Spożywcze',              icon:'🛒', color:'#6B9B6E', subs:['Zakupy spożywcze (ogólne)','Warzywa i owoce','Mięso i ryby','Nabiał','Pieczywo','Mrożonki','Słodycze i przekąski','Napoje bezalkoholowe','Alkohol','Przyprawy i produkty sypkie','Dania gotowe','Karma i akcesoria dla zwierząt']},
  {id:'restauracje',name:'Restauracje i jedzenie',  icon:'🍽️', color:'#D9772E', subs:['Restauracja','Fast food','Kawiarnia / kawa','Dowóz jedzenia','Bar / klub','Lunch w pracy','Stołówka / catering']},
  {id:'transport',  name:'Transport',               icon:'🚗', color:'#4F9D8C', subs:['Paliwo','Komunikacja miejska','Taxi / Uber / Bolt','Serwis i naprawy','Parking','Myjnia','Raty / leasing auta','Ubezpieczenie OC / AC','Przegląd techniczny','Opłaty drogowe / autostrady','Rower / hulajnoga (wynajem)']},
  {id:'dom',        name:'Dom i mieszkanie',        icon:'🏠', color:'#9C6B9E', subs:['Czynsz / kredyt hipoteczny','Czynsz administracyjny / wspólnota','Prąd','Gaz','Woda','Internet','Telewizja','Telefon / abonament','Wyposażenie domu','Środki czystości','Remont i naprawy','Meble','Ogród / balkon']},
  {id:'elektronika',name:'Elektronika',             icon:'💻', color:'#4A7FB5', subs:['Komputer / laptop','Telefon / smartfon','RTV / AGD','Akcesoria komputerowe','Podzespoły PC','Gry komputerowe (cyfrowe)','Serwis elektroniki','Oprogramowanie / licencje','Smart home']},
  {id:'zdrowie',    name:'Zdrowie i uroda',         icon:'💊', color:'#C2587A', subs:['Lekarz','Leki','Dentysta','Siłownia / sport','Kosmetyki','Fryzjer / barber','Suplementy','Badania / diagnostyka','Okulista / okulary','Psycholog / terapia','Fizjoterapia']},
  {id:'odziez',     name:'Odzież i akcesoria',      icon:'👕', color:'#B58C4A', subs:['Ubrania','Buty','Akcesoria','Bielizna','Pranie / czyszczenie','Biżuteria / zegarki']},
  {id:'hobby',      name:'Hobby i rozrywka',        icon:'🎮', color:'#7C5CBF', subs:['Airsoft','Gry i konsole','Subskrypcje (streaming)','Kino','Koncerty i wydarzenia','Fotografia','Książki','Sprzęt PC do gier','E-sport / turnieje','Modelarstwo / kolekcje','Inne hobby']},
  {id:'edukacja',   name:'Edukacja i rozwój',       icon:'📚', color:'#3E8C7E', subs:['Kursy online','Książki edukacyjne','Szkolenia / certyfikaty','Studia / czesne','Konferencje branżowe']},
  {id:'finanse',    name:'Finanse i opłaty',        icon:'💰', color:'#2E8B57', subs:['Opłaty bankowe','Ubezpieczenia','Podatki','Prowizje maklerskie','Spłata długów / rat','Odsetki kredytowe','Inne opłaty finansowe']},
  {id:'podroze',    name:'Podróże',                 icon:'🧳', color:'#C97B4A', subs:['Bilety (lot / kolej)','Nocleg / hotel','Wycieczki i atrakcje','Wynajem auta','Wyżywienie w podróży','Wiza / dokumenty','Bagaż / ubezpieczenie podróżne','Pamiątki']},
  {id:'inne',       name:'Inne',                    icon:'📦', color:'#8C8C8C', subs:['Prezenty','Darowizny','Zwierzęta domowe (weterynarz)','Dzieci','Nieprzewidziane','Pozostałe']},
];
const CAT_BY_ID = {}; CATEGORIES.forEach(c=>CAT_BY_ID[c.id]=c);

const MONTHS_NOM = ['styczeń','luty','marzec','kwiecień','maj','czerwiec','lipiec','sierpień','wrzesień','październik','listopad','grudzień'];
const MONTHS_GEN = ['stycznia','lutego','marca','kwietnia','maja','czerwca','lipca','sierpnia','września','października','listopada','grudnia'];
const WEEKDAYS   = ['niedziela','poniedziałek','wtorek','środa','czwartek','piątek','sobota'];

let dataLayer = null;
let unsubExpenses = null, unsubBudget = null, unsubConn = null;

const today = new Date();
const state = {
  expenses: [],
  budget: null,
  connection: {online:true, pendingWrites:false},
  view: 'add',
  selCatId: null,
  selSub: null,
  selDate: ymd(today),
  editId: null,
  cursor: { y: today.getFullYear(), m: today.getMonth() },
  yearCursor: today.getFullYear(),
};

/* ============ HELPERS ============ */
function ymd(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function parseYmd(s){ const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
function fmtMoney(n){
  if(isNaN(n)) n = 0;
  return n.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' zł';
}
function parseAmountInput(str){
  if(!str) return NaN;
  const cleaned = String(str).replace(/\s/g,'').replace(',', '.');
  return parseFloat(cleaned);
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

let toastTimer=null;
function showToast(msg){
  const el = document.getElementById('toast');
  if(!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>el.classList.remove('show'), 2200);
}

/* Custom confirm modal - replaces native confirm(), which is silently
   blocked in some embedded/mobile webview contexts. */
function showConfirm(message, onYes){
  const overlay = document.getElementById('modalOverlay');
  document.getElementById('modalMessage').textContent = message;
  overlay.classList.add('show');
  const yesBtn = document.getElementById('modalYesBtn');
  const noBtn = document.getElementById('modalNoBtn');
  function cleanup(){
    overlay.classList.remove('show');
    yesBtn.removeEventListener('click', onYesClick);
    noBtn.removeEventListener('click', onNoClick);
    overlay.removeEventListener('click', onOverlayClick);
  }
  function onYesClick(){ cleanup(); onYes(); }
  function onNoClick(){ cleanup(); }
  function onOverlayClick(e){ if(e.target===overlay) cleanup(); }
  yesBtn.addEventListener('click', onYesClick);
  noBtn.addEventListener('click', onNoClick);
  overlay.addEventListener('click', onOverlayClick);
}

function monthExpenses(y,m){
  return state.expenses.filter(e=>{
    const d = parseYmd(e.date);
    return d.getFullYear()===y && d.getMonth()===m;
  });
}
function yearExpenses(y){
  return state.expenses.filter(e=> parseYmd(e.date).getFullYear()===y);
}
function sum(arr){ return arr.reduce((a,e)=>a+e.amount,0); }

function catTotals(list){
  const map = {};
  list.forEach(e=>{ map[e.catId] = (map[e.catId]||0) + e.amount; });
  return Object.keys(map).map(id=>({id, color:(CAT_BY_ID[id]||{}).color||'#888', name:(CAT_BY_ID[id]||{}).name||'Inne', total:map[id]}))
    .sort((a,b)=>b.total-a.total);
}

/* ============ RENDER: ROOT ============ */
function render(){
  document.querySelectorAll('#tabs button').forEach(b=>{
    b.classList.toggle('active', b.dataset.view === state.view);
  });
  const thisMonthTotal = sum(monthExpenses(today.getFullYear(), today.getMonth()));
  document.getElementById('ambient').innerHTML = 'w tym miesiącu<br><b>'+fmtMoney(thisMonthTotal)+'</b>';

  const dot = document.getElementById('syncDot');
  const lbl = document.getElementById('syncLabel');
  if(dot && lbl){
    if(!state.connection.online){ dot.className='sync-dot'; lbl.textContent='offline - czeka na sieć'; }
    else if(state.connection.pendingWrites){ dot.className='sync-dot pending'; lbl.textContent='synchronizowanie…'; }
    else { dot.className='sync-dot online'; lbl.textContent='zsynchronizowano'; }
  }

  const v = document.getElementById('view');
  if(state.view==='add') v.innerHTML = renderAdd();
  else if(state.view==='month') v.innerHTML = renderMonth();
  else if(state.view==='year') v.innerHTML = renderYear();
  else if(state.view==='settings') v.innerHTML = renderSettings();
  attachHandlers();
}

/* ============ RENDER: ADD ============ */
function renderAdd(){
  const selCat = state.selCatId ? CAT_BY_ID[state.selCatId] : null;
  const isToday = state.selDate === ymd(today);
  const yest = new Date(today); yest.setDate(yest.getDate()-1);
  const isYest = state.selDate === ymd(yest);

  const catGrid = CATEGORIES.map(c=>`
    <button class="cat-chip ${c.id===state.selCatId?'selected':''}" style="--cat-color:${c.color}" data-act="pickcat" data-id="${c.id}">
      <span class="ic">${c.icon}</span><span class="lbl">${escapeHtml(c.name)}</span>
    </button>`).join('');

  let subPanel = '';
  if(selCat && !state.selSub){
    subPanel = `<div class="sub-panel"><div class="sub-chips">` +
      selCat.subs.map(s=>`<button class="sub-chip" style="--cat-color:${selCat.color}" data-act="picksub" data-sub="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('') +
      `</div></div>`;
  } else if(selCat && state.selSub){
    subPanel = `<div class="chosen-line">
      <span class="pick">${selCat.icon} ${escapeHtml(selCat.name)} → ${escapeHtml(state.selSub)}</span>
      <button data-act="changecat">zmień</button>
    </div>`;
  }

  const amountVal = state._amountDraft || '';
  const noteVal = state._noteDraft || '';
  const canSave = (parseAmountInput(amountVal) > 0) && state.selSub;

  return `
  <div class="ledger">
    <div class="amount-label">Ile wydałeś?</div>
    <div class="amount-wrap">
      <input id="amountInput" type="text" inputmode="decimal" placeholder="0,00" value="${escapeHtml(amountVal)}" autocomplete="off">
      <span class="cur">zł</span>
    </div>
    <div class="cat-grid">${catGrid}</div>
    ${subPanel}
    <div class="meta-row">
      <button class="pill-btn ${isToday?'selected':''}" data-act="setdate" data-val="${ymd(today)}">Dziś</button>
      <button class="pill-btn ${isYest?'selected':''}" data-act="setdate" data-val="${ymd(yest)}">Wczoraj</button>
      <input class="date-input" id="dateInput" type="date" value="${state.selDate}">
    </div>
    <input class="note-input" id="noteInput" type="text" placeholder="Notatka (opcjonalnie)" value="${escapeHtml(noteVal)}" maxlength="120">
    <button class="save-btn" id="saveBtn" ${canSave?'':'disabled'}>${state.editId ? 'Zapisz zmiany' : 'Zapisz wydatek'}</button>
    ${state.editId ? '<button class="cancel-edit" id="cancelEditBtn">Anuluj edycję</button>' : ''}
  </div>
  ${renderRecent()}
  `;
}

function renderRecent(){
  const recent = [...state.expenses].sort((a,b)=> (b.date+'_'+b.createdAt) > (a.date+'_'+a.createdAt) ? 1 : -1).slice(0,8);
  if(recent.length===0){
    return `<div class="card"><div class="empty-state"><span class="ic">🧾</span>Brak zapisanych wydatków.<br>Dodaj pierwszy powyżej.</div></div>`;
  }
  return `<div class="card"><h2>Ostatnie wpisy</h2>${recent.map(rowHtml).join('')}</div>`;
}

function rowHtml(e){
  const c = CAT_BY_ID[e.catId] || {icon:'📦', color:'#888', name:'Inne'};
  const d = parseYmd(e.date);
  const dateLbl = d.getDate()+' '+MONTHS_GEN[d.getMonth()];
  return `<div class="tx-row" data-act="editrow" data-id="${e.id}">
    <div class="tx-ic" style="background:${c.color}33;color:${c.color}">${c.icon}</div>
    <div class="tx-main">
      <div class="tx-sub">${escapeHtml(e.sub)}</div>
      <div class="tx-meta">${dateLbl}${e.note ? ' · '+escapeHtml(e.note) : ''}</div>
    </div>
    <div class="tx-amount">${fmtMoney(e.amount)}</div>
    <button class="tx-del" data-act="delrow" data-id="${e.id}" title="Usuń" aria-label="Usuń">✕</button>
  </div>`;
}

/* ============ RENDER: MONTH ============ */
function renderMonth(){
  const {y,m} = state.cursor;
  const list = monthExpenses(y,m).sort((a,b)=> a.date===b.date ? 0 : (a.date<b.date?1:-1));
  const total = sum(list);

  const prevD = new Date(y,m-1,1); const prevTotal = sum(monthExpenses(prevD.getFullYear(), prevD.getMonth()));
  let deltaHtml = '';
  if(prevTotal>0){
    const diff = ((total-prevTotal)/prevTotal)*100;
    const cls = diff>0 ? 'delta-up' : 'delta-down';
    const arrow = diff>0 ? '↑' : '↓';
    deltaHtml = `<span class="${cls}">${arrow} ${Math.abs(diff).toFixed(0)}%</span> vs poprz. miesiąc`;
  }

  const days = new Set(list.map(e=>e.date)).size;
  const avgDay = days>0 ? total/days : 0;

  const cats = catTotals(list);
  const topCat = cats[0];

  let budgetRing = '';
  if(state.budget && state.budget>0){
    const pct = Math.min(total/state.budget,1.4);
    const ringColor = pct<0.8 ? '#4F9D8C' : (pct<=1 ? '#E0982E' : '#C25450');
    budgetRing = donutRing(Math.min(pct,1), ringColor, Math.round(Math.min(pct,9.99)*100)+'%', 'z '+fmtMoney(state.budget)+' budżetu');
  }

  const catRows = cats.map(c=>{
    const pct = total>0 ? (c.total/total*100) : 0;
    return `<div class="cat-list-row"><span class="dot" style="background:${c.color}"></span><span class="name">${escapeHtml(c.name)}</span><span class="pct">${pct.toFixed(0)}%</span><span class="amt">${fmtMoney(c.total)}</span></div>`;
  }).join('');

  let listHtml = '';
  let lastDate = null;
  list.forEach(e=>{
    if(e.date !== lastDate){
      const d = parseYmd(e.date);
      listHtml += `<div class="day-header">${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS_GEN[d.getMonth()]}</div>`;
      lastDate = e.date;
    }
    listHtml += rowHtml(e);
  });
  if(list.length===0) listHtml = `<div class="empty-state"><span class="ic">📭</span>Brak wydatków w tym miesiącu.</div>`;

  return `
  <div class="period-nav">
    <button data-act="monthnav" data-dir="-1">‹</button>
    <div class="label">${MONTHS_NOM[m]} ${y}</div>
    <button data-act="monthnav" data-dir="1">›</button>
  </div>
  <div class="card">
    <div class="stat-grid">
      <div class="stat-box"><div class="v">${fmtMoney(total)}</div><div class="l">Suma wydatków</div></div>
      <div class="stat-box"><div class="v">${fmtMoney(avgDay)}</div><div class="l">Średnio / dzień</div></div>
    </div>
    <div class="muted" style="margin-top:8px;">${deltaHtml || 'Brak danych z poprzedniego miesiąca'}${topCat ? ' · najwięcej: '+escapeHtml(topCat.name) : ''}</div>
  </div>
  <div class="card">
    <h2>Podział na kategorie</h2>
    <div class="donut-wrap">
      ${cats.length ? donutChart(cats) : ''}
      <div class="cat-list">${catRows || '<div class="muted">Brak danych.</div>'}</div>
      ${budgetRing}
    </div>
  </div>
  <div class="card">
    <h2>Wpisy</h2>
    ${listHtml}
  </div>
  `;
}

function donutChart(cats){
  const size=110, stroke=16, r=(size-stroke)/2, c=size/2, circ=2*Math.PI*r;
  const total = cats.reduce((a,x)=>a+x.total,0);
  let offset=0;
  const circles = cats.map(cat=>{
    const frac = total>0 ? cat.total/total : 0;
    const dash = frac*circ;
    const html = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${cat.color}" stroke-width="${stroke}" stroke-dasharray="${dash.toFixed(2)} ${(circ-dash).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${c} ${c})"/>`;
    offset += dash;
    return html;
  }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="flex-shrink:0">${circles}</svg>`;
}

function donutRing(pct, color, pctLabel, subLabel){
  const size=110, stroke=12, r=(size-stroke)/2, c=size/2, circ=2*Math.PI*r;
  const dash = pct*circ;
  return `<div class="budget-ring-wrap">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(237,234,224,0.16)" stroke-width="${stroke}"/>
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
        stroke-dasharray="${dash.toFixed(2)} ${(circ-dash).toFixed(2)}" transform="rotate(-90 ${c} ${c})"/>
    </svg>
    <div class="ring-text"><span class="pct">${pctLabel}</span><span class="lbl">${subLabel}</span></div>
  </div>`;
}

/* ============ RENDER: YEAR ============ */
function renderYear(){
  const y = state.yearCursor;
  const list = yearExpenses(y);
  const total = sum(list);
  const prevTotal = sum(yearExpenses(y-1));
  let deltaHtml = '';
  if(prevTotal>0){
    const diff = ((total-prevTotal)/prevTotal)*100;
    const cls = diff>0 ? 'delta-up' : 'delta-down';
    const arrow = diff>0 ? '↑' : '↓';
    deltaHtml = `<span class="${cls}">${arrow} ${Math.abs(diff).toFixed(0)}%</span> vs ${y-1}`;
  }
  const monthsActive = new Set(list.map(e=>parseYmd(e.date).getMonth())).size;
  const avgMonth = monthsActive>0 ? total/monthsActive : 0;

  const monthTotals = Array.from({length:12},(_,m)=> sum(monthExpenses(y,m)));
  const max = Math.max(...monthTotals, 1);
  const bars = monthTotals.map((v,m)=>{
    const h = Math.max((v/max)*100, v>0?3:0);
    const isCur = (y===today.getFullYear() && m===today.getMonth());
    return `<div class="bar-col">
      <div class="bar ${isCur?'current':''}" style="height:${h}%" title="${MONTHS_NOM[m]}: ${fmtMoney(v)}"></div>
      <div class="m-lbl">${MONTHS_NOM[m].slice(0,3)}</div>
    </div>`;
  }).join('');

  const cats = catTotals(list);
  const catMax = cats.length ? cats[0].total : 1;
  const catRows = cats.map(c=>{
    const pct = total>0 ? (c.total/total*100) : 0;
    const barPct = (c.total/catMax*100);
    return `<tr>
      <td><span class="dot" style="background:${c.color};display:inline-block;margin-right:7px"></span>${escapeHtml(c.name)}
        <div class="bar-mini"><i style="width:${barPct}%;background:${c.color}"></i></div>
      </td>
      <td class="amt">${fmtMoney(c.total)}<br><span class="muted" style="font-size:11px">${pct.toFixed(0)}%</span></td>
    </tr>`;
  }).join('');

  return `
  <div class="period-nav">
    <button data-act="yearnav" data-dir="-1">‹</button>
    <div class="label">Rok ${y}</div>
    <button data-act="yearnav" data-dir="1">›</button>
  </div>
  <div class="card">
    <div class="stat-grid">
      <div class="stat-box"><div class="v">${fmtMoney(total)}</div><div class="l">Suma za rok</div></div>
      <div class="stat-box"><div class="v">${fmtMoney(avgMonth)}</div><div class="l">Średnio / miesiąc</div></div>
    </div>
    <div class="muted" style="margin-top:8px;">${deltaHtml || 'Brak danych z poprzedniego roku'}</div>
  </div>
  <div class="card">
    <h2>Wydatki miesiąc po miesiącu</h2>
    <div class="bar-chart">${bars}</div>
  </div>
  <div class="card">
    <h2>Kategorie w ${y} roku</h2>
    ${cats.length ? `<table class="cat-table">${catRows}</table>` : '<div class="muted">Brak danych dla tego roku.</div>'}
  </div>
  `;
}

/* ============ RENDER: SETTINGS ============ */
function renderSettings(){
  const count = state.expenses.length;
  const oldest = state.expenses.length ? state.expenses.reduce((a,e)=> e.date<a.date?e:a).date : null;
  return `
  <div class="card">
    <h2>Budżet miesięczny</h2>
    <div class="settings-row">
      <div><div class="t">Limit wydatków na miesiąc</div><div class="d">Pokazuje pierścień postępu w widoku „Miesiąc” - synchronizuje się na wszystkich urządzeniach</div></div>
      <input class="num-input" id="budgetInput" type="text" inputmode="decimal" placeholder="np. 3000" value="${state.budget ? String(state.budget).replace('.',',') : ''}">
    </div>
    <button class="btn accent" id="saveBudgetBtn" style="margin-top:8px;">Zapisz budżet</button>
  </div>
  <div class="card">
    <h2>Dane</h2>
    <div class="settings-row">
      <div><div class="t">Zapisanych wydatków</div><div class="d">${count} wpisów${oldest ? ', od '+escapeHtml(oldest) : ''}</div></div>
    </div>
    <div class="settings-row">
      <div><div class="t">Eksportuj dane</div><div class="d">Zapisz kopię zapasową jako plik JSON</div></div>
      <button class="btn" id="exportBtn">Eksportuj</button>
    </div>
    <div class="settings-row">
      <div><div class="t">Importuj dane</div><div class="d">Dodaj wpisy z pliku JSON (np. z poprzedniej wersji aplikacji)</div></div>
      <button class="btn" id="importBtn">Importuj</button>
      <input type="file" id="importFile" accept="application/json">
    </div>
  </div>
  <div class="card">
    <h2>Konto</h2>
    <div class="settings-row">
      <div><div class="t">Wyloguj się</div><div class="d">Dane zostają bezpiecznie w chmurze, zalogujesz się ponownie na każdym urządzeniu</div></div>
      <button class="btn danger" id="signOutBtn">Wyloguj</button>
    </div>
  </div>
  <div class="card">
    <h2>O aplikacji</h2>
    <div class="muted">
      Wydatki działa offline - dodawanie, edycja i usuwanie wpisów zawsze działają lokalnie, nawet bez internetu.
      Gdy urządzenie złapie sieć, zmiany synchronizują się automatycznie ze wszystkimi Twoimi urządzeniami przez Firebase.
    </div>
  </div>
  `;
}

/* ============ EVENTS ============ */
function attachHandlers(){
  document.getElementById('tabs').onclick = (ev)=>{
    const btn = ev.target.closest('button[data-view]');
    if(!btn) return;
    if(state.view==='add'){ state._amountDraft = (document.getElementById('amountInput')||{}).value; state._noteDraft = (document.getElementById('noteInput')||{}).value; }
    state.view = btn.dataset.view;
    render();
  };

  const view = document.getElementById('view');
  view.onclick = null; // clear any handler from a previous render to avoid stacking

  if(state.view==='add'){
    const amountEl = document.getElementById('amountInput');
    const noteEl = document.getElementById('noteInput');
    const dateEl = document.getElementById('dateInput');

    amountEl.addEventListener('input', ()=>{ state._amountDraft = amountEl.value; updateSaveState(); });
    amountEl.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ attemptSave(); } });
    noteEl.addEventListener('input', ()=>{ state._noteDraft = noteEl.value; });
    noteEl.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ attemptSave(); } });
    dateEl.addEventListener('change', ()=>{ state.selDate = dateEl.value; render(); });

    view.onclick = (ev)=>{
      const t = ev.target.closest('[data-act]');
      if(!t) return;
      const act = t.dataset.act;
      if(act==='pickcat'){
        state._amountDraft = amountEl.value; state._noteDraft = noteEl.value;
        state.selCatId = t.dataset.id; state.selSub = null; render();
      } else if(act==='picksub'){
        state.selSub = t.dataset.sub; render();
        setTimeout(()=>{ const a=document.getElementById('amountInput'); if(a){ a.focus(); a.select(); } },0);
      } else if(act==='changecat'){
        state.selSub = null; render();
      } else if(act==='setdate'){
        state.selDate = t.dataset.val; render();
      } else if(act==='editrow'){
        startEdit(t.dataset.id);
      } else if(act==='delrow'){
        ev.stopPropagation();
        confirmDelete(t.dataset.id);
      }
    };

    document.getElementById('saveBtn').addEventListener('click', attemptSave);
    const cancelBtn = document.getElementById('cancelEditBtn');
    if(cancelBtn) cancelBtn.addEventListener('click', cancelEdit);
  }

  if(state.view==='month'){
    view.querySelector('[data-dir="-1"]').addEventListener('click', ()=>shiftMonth(-1));
    view.querySelector('[data-dir="1"]').addEventListener('click', ()=>shiftMonth(1));
    view.onclick = (ev)=>{
      const t = ev.target.closest('[data-act]');
      if(!t) return;
      if(t.dataset.act==='editrow') startEdit(t.dataset.id);
      else if(t.dataset.act==='delrow'){ ev.stopPropagation(); confirmDelete(t.dataset.id); }
    };
  }

  if(state.view==='year'){
    view.querySelector('[data-dir="-1"]').addEventListener('click', ()=>{ state.yearCursor--; render(); });
    view.querySelector('[data-dir="1"]').addEventListener('click', ()=>{ state.yearCursor++; render(); });
  }

  if(state.view==='settings'){
    document.getElementById('saveBudgetBtn').addEventListener('click', ()=>{
      const v = parseAmountInput(document.getElementById('budgetInput').value);
      const newBudget = (v>0) ? v : null;
      dataLayer.setBudget(newBudget).then(()=>{
        showToast(newBudget ? 'Budżet zapisany' : 'Budżet usunięty');
      }).catch(err=>{ console.error(err); showToast('Nie udało się zapisać budżetu'); });
    });
    document.getElementById('exportBtn').addEventListener('click', exportData);
    document.getElementById('importBtn').addEventListener('click', ()=> document.getElementById('importFile').click());
    document.getElementById('importFile').addEventListener('change', importData);
    document.getElementById('signOutBtn').addEventListener('click', ()=>{
      showConfirm('Wylogować z tego urządzenia?', ()=>{ dataLayer.signOut(); });
    });
  }
}

function updateSaveState(){
  const amountEl = document.getElementById('amountInput');
  const btn = document.getElementById('saveBtn');
  if(!btn) return;
  const ok = parseAmountInput(amountEl.value) > 0 && state.selSub;
  btn.disabled = !ok;
}

function attemptSave(){
  const amountEl = document.getElementById('amountInput');
  const noteEl = document.getElementById('noteInput');
  const amount = parseAmountInput(amountEl.value);
  if(!(amount>0)){ amountEl.focus(); return; }
  if(!state.selCatId || !state.selSub){ showToast('Wybierz kategorię wydatku'); return; }

  const payload = { amount, catId: state.selCatId, sub: state.selSub, date: state.selDate, note: noteEl.value.trim() };

  if(state.editId){
    const id = state.editId;
    dataLayer.updateExpense(id, payload).then(()=>{
      showToast('Zmiany zapisane');
    }).catch(err=>{ console.error(err); showToast('Nie udało się zapisać zmian'); });
    state.editId = null;
  } else {
    dataLayer.addExpense(Object.assign({createdAt: Date.now()}, payload)).then(()=>{
      showToast('Zapisano: '+fmtMoney(amount)+' - '+state.selSub);
    }).catch(err=>{ console.error(err); showToast('Nie udało się zapisać - sprawdź połączenie'); });
  }

  state._amountDraft = '';
  state._noteDraft = '';
  render();
  setTimeout(()=>{ const a=document.getElementById('amountInput'); if(a) a.focus(); },0);
}

function startEdit(id){
  const ex = state.expenses.find(e=>e.id===id);
  if(!ex) return;
  state.editId = id;
  state.selCatId = ex.catId;
  state.selSub = ex.sub;
  state.selDate = ex.date;
  state._amountDraft = String(ex.amount).replace('.',',');
  state._noteDraft = ex.note || '';
  state.view = 'add';
  render();
  if(typeof window!=='undefined' && window.scrollTo) window.scrollTo({top:0, behavior:'smooth'});
}

function cancelEdit(){
  state.editId = null;
  state.selCatId = null; state.selSub = null;
  state._amountDraft=''; state._noteDraft='';
  state.selDate = ymd(today);
  render();
}

function confirmDelete(id){
  showConfirm('Usunąć ten wydatek? Tej operacji nie można odwrócić.', ()=>{
    dataLayer.deleteExpense(id).then(()=>{
      showToast('Wydatek usunięty');
    }).catch(err=>{ console.error(err); showToast('Nie udało się usunąć - sprawdź połączenie'); });
  });
}

function exportData(){
  const payload = { exportedAt: new Date().toISOString(), budget: state.budget, expenses: state.expenses };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = ymd(today);
  a.href = url; a.download = 'wydatki-eksport-'+stamp+'.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Wyeksportowano dane');
}

function importData(ev){
  const file = ev.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const data = JSON.parse(reader.result);
      const incoming = Array.isArray(data) ? data : data.expenses;
      if(!Array.isArray(incoming)) throw new Error('Nieprawidłowy format');
      const valid = incoming.filter(e=> e && typeof e.amount==='number' && e.date && e.sub);
      showToast('Importowanie '+valid.length+' wpisów…');
      Promise.all(valid.map(e=> dataLayer.addExpense({
        amount: e.amount, catId: CAT_BY_ID[e.catId] ? e.catId : 'inne',
        sub: e.sub, date: e.date, note: e.note||'', createdAt: e.createdAt || Date.now()
      }))).then(()=>{
        showToast('Zaimportowano '+valid.length+' wpisów');
      }).catch(err=>{ console.error(err); showToast('Część wpisów nie została zaimportowana'); });
    }catch(err){
      console.error(err);
      showToast('Nie udało się odczytać pliku - sprawdź, czy to poprawny eksport.');
    }
  };
  reader.readAsText(file);
  ev.target.value = '';
}

function shiftMonth(dir){
  let {y,m} = state.cursor;
  m += dir;
  if(m<0){ m=11; y--; } else if(m>11){ m=0; y++; }
  state.cursor = {y,m};
  render();
}

/* ============ INIT / TEARDOWN ============ */
function init(layer){
  dataLayer = layer;
  unsubExpenses = dataLayer.onExpenses(list=>{
    state.expenses = list;
    render();
  });
  unsubBudget = dataLayer.onBudget(val=>{
    state.budget = val;
    render();
  });
  unsubConn = dataLayer.onConnection(info=>{
    state.connection = info;
    render();
  });
  render();
}

function teardown(){
  if(unsubExpenses) unsubExpenses();
  if(unsubBudget) unsubBudget();
  if(unsubConn) unsubConn();
  state.expenses = []; state.budget = null;
  state.selCatId=null; state.selSub=null; state.editId=null; state.view='add';
}

return { init, teardown, _internal: { state, CATEGORIES, fmtMoney, parseAmountInput } };
})();
