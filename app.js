/* =====================================================================
   AppCore - all UI / state / rendering logic, independent of Firebase.
   Talks to the outside world only through the `dataLayer` object passed
   into AppCore.init(dataLayer).

   dataLayer contract (all required):
     onExpensesRange(startYmd,endYmd,cb) -> cb(array); returns unsubscribe()
     addExpense(data) / updateExpense(id,data) / deleteExpense(id) -> Promise
     onIncomeRange(startYmd,endYmd,cb)   -> cb(array); returns unsubscribe()
     addIncome(data) / updateIncome(id,data) / deleteIncome(id) -> Promise
     onRecurring(cb)                     -> cb(array); returns unsubscribe()
     addRecurring(data) / updateRecurring(id,data) / deleteRecurring(id) -> Promise
     onSettings(cb)                      -> cb(object); returns unsubscribe()
     setSettings(partial)                -> Promise
     onConnection(cb)                    -> cb({online,pendingWrites}); returns unsubscribe()
     signOut()                           -> Promise
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

const INCOME_CATS = [
  {id:'pensja',     name:'Pensja',                  icon:'💼', color:'#4F9D8C'},
  {id:'freelance',  name:'Freelance / zlecenie',    icon:'🧑‍💻', color:'#3E8C7E'},
  {id:'premia',     name:'Premia / bonus',          icon:'⭐', color:'#E0982E'},
  {id:'zwrot',      name:'Zwrot / refundacja',      icon:'↩️', color:'#7C5CBF'},
  {id:'sprzedaz',   name:'Sprzedaż',                icon:'🏷️', color:'#B58C4A'},
  {id:'inwestycje', name:'Inwestycje / dywidendy',  icon:'📈', color:'#4A7FB5'},
  {id:'prezent',    name:'Prezent',                 icon:'🎁', color:'#C2587A'},
  {id:'inne',       name:'Inne',                    icon:'📦', color:'#8C8C8C'},
];
const INC_BY_ID = {}; INCOME_CATS.forEach(c=>INC_BY_ID[c.id]=c);

const MONTHS_NOM = ['styczeń','luty','marzec','kwiecień','maj','czerwiec','lipiec','sierpień','wrzesień','październik','listopad','grudzień'];
const MONTHS_GEN = ['stycznia','lutego','marca','kwietnia','maja','czerwca','lipca','sierpnia','września','października','listopada','grudnia'];
const WEEKDAYS   = ['niedziela','poniedziałek','wtorek','środa','czwartek','piątek','sobota'];

let dataLayer = null;
let unsubExpenses = null, unsubIncome = null, unsubRecurring = null, unsubSettings = null, unsubConn = null;

const today = new Date();
const state = {
  expenses: [],
  income: [],
  recurring: [],
  budget: null,
  categoryBudgets: {},      // {catId: amount}
  friendName: 'Znajomy',
  connection: {online:true, pendingWrites:false},

  view: 'add',
  addMode: 'expense',       // 'expense' | 'income'
  selCatId: null,           // expense category OR income source id depending on addMode
  selSub: null,
  selDate: ymd(today),
  editId: null,
  editType: null,           // 'expense' | 'income'
  splitOn: false,
  splitShare: 50,           // % of the expense that is YOURS

  numpadOpen: false,
  theme: readTheme(),

  cursor: { y: today.getFullYear(), m: today.getMonth() },
  yearCursor: today.getFullYear(),
  splitCursor: { y: today.getFullYear(), m: today.getMonth() },

  filterCatId: null,        // month view category filter
  searchQuery: '',          // month view text search

  // recurring editor draft
  recDraft: null,           // {type,amount,catId,sub,dayOfMonth,note} | null

  // date window for range subscriptions (grows as the user navigates)
  windowMinYear: today.getFullYear()-1,
  windowMaxYear: today.getFullYear(),

  _amountDraft: '',
  _noteDraft: '',
};

// load gates for one-shot recurring generation
let recurringLoaded=false, expensesLoaded=false, incomeLoaded=false, recurringDone=false;

/* ============ HELPERS ============ */
function pad2(n){ return String(n).padStart(2,'0'); }
function ymd(d){ return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()); }
function ymOf(s){ return s.slice(0,7); }
function parseYmd(s){ const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
function daysInMonth(y,m){ return new Date(y,m+1,0).getDate(); }
function readTheme(){ try{ return localStorage.getItem('wydatki-theme')||'dark'; }catch(e){ return 'dark'; } }

function fmtMoney(n){
  if(isNaN(n)) n = 0;
  return n.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' zł';
}
function fmtSigned(n){
  const s = n>=0 ? '+' : '−';
  return s+' '+fmtMoney(Math.abs(n));
}
function parseAmountInput(str){
  if(!str) return NaN;
  const cleaned = String(str).replace(/\s/g,'').replace(',', '.');
  return parseFloat(cleaned);
}
/* Evaluate a simple +/- expression typed in the amount field, e.g. "30+12+5".
   Only + and - between numbers; left to right. Returns a number or NaN. */
function evalAmountExpr(str){
  if(!str) return NaN;
  const cleaned = String(str).replace(/\s/g,'').replace(/,/g,'.');
  if(!/^[0-9.+\-]+$/.test(cleaned)) return parseAmountInput(str);
  const m = cleaned.match(/[+\-]?[0-9]*\.?[0-9]+/g);
  if(!m) return NaN;
  let total = 0;
  for(const tok of m){ const v = parseFloat(tok); if(isNaN(v)) return NaN; total += v; }
  return total;
}
/* Max kwota: 10 000 000, max 2 miejsca po przecinku. */
const MAX_AMOUNT = 10000000;
const MAX_INT_DIGITS = 8; // 10 000 000 ma 8 cyfr

/* Czyści i ogranicza wpisaną kwotę/wyrażenie:
   - tylko cyfry, przecinek oraz + / - (kropka zamieniana na przecinek)
   - max 2 cyfry po przecinku w każdym segmencie
   - każdy segment <= MAX_AMOUNT (max 8 cyfr części całkowitej)
   - brak podwójnych operatorów */
function sanitizeAmount(raw){
  let s = String(raw).replace(/\./g, ',').replace(/[^0-9,+\-]/g, '');
  s = s.replace(/([+\-]){2,}/g, '$1');
  const parts = s.split(/([+\-])/);
  let out = '';
  for(let i=0;i<parts.length;i++){
    let p = parts[i];
    if(p==='+'||p==='-'){ out+=p; continue; }
    if(p==='') continue;
    const ci = p.indexOf(',');
    if(ci!==-1){
      let intPart = p.slice(0,ci).replace(/,/g,'').slice(0,MAX_INT_DIGITS);
      let dec = p.slice(ci+1).replace(/,/g,'').slice(0,2);
      p = intPart + ',' + dec;
    } else if(p.length>MAX_INT_DIGITS){
      p = p.slice(0,MAX_INT_DIGITS);
    }
    const val = parseFloat(p.replace(',','.'));
    if(!isNaN(val) && val>MAX_AMOUNT) p = '10000000';
    out += p;
  }
  return out;
}

/* Dopasowuje rozmiar czcionki pola kwoty i przewija do końca,
   żeby zawsze było widać ostatnio wpisane znaki (problem przy kalkulatorze). */
function fitAmountField(el){
  if(!el) return;
  const len = el.value.length;
  let size = 40;
  if(len>8) size = Math.max(20, 40 - (len-8)*2.1);
  el.style.fontSize = size+'px';
  el.scrollLeft = el.scrollWidth;
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

/* Custom confirm modal - replaces native confirm(), silently blocked in
   some embedded/mobile webview contexts. yesLabel customises the button. */
function showConfirm(message, onYes, yesLabel){
  const overlay = document.getElementById('modalOverlay');
  document.getElementById('modalMessage').textContent = message;
  const yesBtn = document.getElementById('modalYesBtn');
  const noBtn = document.getElementById('modalNoBtn');
  yesBtn.textContent = yesLabel || 'Usuń';
  overlay.classList.add('show');
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
  return state.expenses.filter(e=>{ const d=parseYmd(e.date); return d.getFullYear()===y && d.getMonth()===m; });
}
function monthIncome(y,m){
  return state.income.filter(e=>{ const d=parseYmd(e.date); return d.getFullYear()===y && d.getMonth()===m; });
}
function yearExpenses(y){ return state.expenses.filter(e=> parseYmd(e.date).getFullYear()===y); }
function yearIncome(y){ return state.income.filter(e=> parseYmd(e.date).getFullYear()===y); }
function sum(arr){ return arr.reduce((a,e)=>a+e.amount,0); }

function catTotals(list){
  const map = {};
  list.forEach(e=>{ map[e.catId] = (map[e.catId]||0) + e.amount; });
  return Object.keys(map).map(id=>({id, color:(CAT_BY_ID[id]||{}).color||'#888', name:(CAT_BY_ID[id]||{}).name||'Inne', total:map[id]}))
    .sort((a,b)=>b.total-a.total);
}

/* myShare / friendShare for a split expense (logger is assumed payer). */
function splitParts(e){
  if(!e.split || !e.split.enabled) return null;
  const share = (typeof e.split.share==='number') ? e.split.share : 0.5;
  const mine = e.amount * share;
  return { mine, friend: e.amount - mine };
}

/* ============ RENDER: ROOT ============ */
function render(){
  document.querySelectorAll('#tabs button').forEach(b=>{
    b.classList.toggle('active', b.dataset.view === state.view);
  });
  const mIncome = sum(monthIncome(today.getFullYear(), today.getMonth()));
  const mExpense = sum(monthExpenses(today.getFullYear(), today.getMonth()));
  const bal = mIncome - mExpense;
  const ambient = document.getElementById('ambient');
  if(ambient){
    ambient.innerHTML = 'bilans miesiąca<br><b class="'+(bal>=0?'amb-pos':'amb-neg')+'">'+fmtSigned(bal)+'</b>';
  }

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
  else if(state.view==='shared') v.innerHTML = renderShared();
  else if(state.view==='settings') v.innerHTML = renderSettings();
  attachHandlers();
}

/* ============ RENDER: ADD ============ */
function renderAdd(){
  const seg = `
    <div class="seg">
      <button class="${state.addMode==='expense'?'active':''}" data-act="mode" data-val="expense">Wydatek</button>
      <button class="${state.addMode==='income'?'active income':''}" data-act="mode" data-val="income">Przychód</button>
    </div>`;
  return state.addMode==='income' ? renderAddIncome(seg) : renderAddExpense(seg);
}

function renderAddExpense(seg){
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
  const canSave = (evalAmountExpr(amountVal) > 0) && state.selSub;

  const splitBlock = `
    <div class="split-block ${state.splitOn?'on':''}">
      <label class="split-toggle">
        <span>🤝 Wydatek wspólny${state.friendName?(' z: '+escapeHtml(state.friendName)):''}</span>
        <button class="switch ${state.splitOn?'on':''}" data-act="togglesplit" aria-pressed="${state.splitOn}"><i></i></button>
      </label>
      ${state.splitOn ? `
        <div class="split-detail">
          <div class="muted" style="margin-bottom:6px;">Twój udział: <b>${state.splitShare}%</b> · ${state.friendName} oddaje resztę</div>
          <div class="split-ratios">
            ${[50,33,67,100].map(p=>`<button class="ratio ${state.splitShare===p?'sel':''}" data-act="setshare" data-val="${p}">${p===33?'⅓':p===67?'⅔':p+'%'}</button>`).join('')}
            <input class="ratio-input" id="shareInput" type="number" min="1" max="100" value="${state.splitShare}" inputmode="numeric">
          </div>
        </div>` : ''}
    </div>`;

  return `
  <div class="ledger">
    ${seg}
    <div class="amount-label">Ile wydałeś?</div>
    <div class="amount-wrap">
      <input id="amountInput" type="text" inputmode="decimal" placeholder="0,00" value="${escapeHtml(amountVal)}" autocomplete="off" ${state.numpadOpen?'readonly':''}>
      <span class="cur">zł</span>
      <button class="numpad-toggle ${state.numpadOpen?'on':''}" data-act="togglenumpad" title="Kalkulator" aria-label="Kalkulator">🔢</button>
    </div>
    ${state.numpadOpen ? renderNumpad(amountVal) : ''}
    <div class="cat-grid">${catGrid}</div>
    ${subPanel}
    <div class="meta-row">
      <button class="pill-btn ${isToday?'selected':''}" data-act="setdate" data-val="${ymd(today)}">Dziś</button>
      <button class="pill-btn ${isYest?'selected':''}" data-act="setdate" data-val="${ymd(yest)}">Wczoraj</button>
      <input class="date-input" id="dateInput" type="date" value="${state.selDate}">
    </div>
    <input class="note-input" id="noteInput" type="text" placeholder="Notatka (opcjonalnie)" value="${escapeHtml(noteVal)}" maxlength="120" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
    ${splitBlock}
    <button class="save-btn" id="saveBtn" ${canSave?'':'disabled'}>${state.editId ? 'Zapisz zmiany' : 'Zapisz wydatek'}</button>
    ${state.editId ? '<button class="cancel-edit" id="cancelEditBtn">Anuluj edycję</button>' : ''}
  </div>
  ${renderRecent()}
  `;
}

function renderAddIncome(seg){
  const isToday = state.selDate === ymd(today);
  const yest = new Date(today); yest.setDate(yest.getDate()-1);
  const isYest = state.selDate === ymd(yest);

  const grid = INCOME_CATS.map(c=>`
    <button class="cat-chip ${c.id===state.selCatId?'selected':''}" style="--cat-color:${c.color}" data-act="pickinc" data-id="${c.id}">
      <span class="ic">${c.icon}</span><span class="lbl">${escapeHtml(c.name)}</span>
    </button>`).join('');

  const amountVal = state._amountDraft || '';
  const noteVal = state._noteDraft || '';
  const canSave = (evalAmountExpr(amountVal) > 0) && state.selCatId;

  return `
  <div class="ledger income">
    ${seg}
    <div class="amount-label">Ile wpłynęło?</div>
    <div class="amount-wrap">
      <input id="amountInput" type="text" inputmode="decimal" placeholder="0,00" value="${escapeHtml(amountVal)}" autocomplete="off" ${state.numpadOpen?'readonly':''}>
      <span class="cur">zł</span>
      <button class="numpad-toggle ${state.numpadOpen?'on':''}" data-act="togglenumpad" title="Kalkulator" aria-label="Kalkulator">🔢</button>
    </div>
    ${state.numpadOpen ? renderNumpad(amountVal) : ''}
    <div class="cat-grid inc">${grid}</div>
    <div class="meta-row">
      <button class="pill-btn ${isToday?'selected':''}" data-act="setdate" data-val="${ymd(today)}">Dziś</button>
      <button class="pill-btn ${isYest?'selected':''}" data-act="setdate" data-val="${ymd(yest)}">Wczoraj</button>
      <input class="date-input" id="dateInput" type="date" value="${state.selDate}">
    </div>
    <input class="note-input" id="noteInput" type="text" placeholder="Notatka (np. pracodawca)" value="${escapeHtml(noteVal)}" maxlength="120" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
    <button class="save-btn income" id="saveBtn" ${canSave?'':'disabled'}>${state.editId ? 'Zapisz zmiany' : 'Zapisz przychód'}</button>
    ${state.editId ? '<button class="cancel-edit" id="cancelEditBtn">Anuluj edycję</button>' : ''}
  </div>
  ${renderRecent()}
  `;
}

function renderNumpad(val){
  const preview = evalAmountExpr(val);
  const showPreview = /[+\-]/.test(String(val)) && !isNaN(preview);
  // Układ jak w prawdziwym kalkulatorze: cyfry po lewej, operatory i ⌫ w prawej kolumnie.
  const k = (key, label, cls)=>`<button class="np-key ${cls||''}" data-act="np" data-k="${key}">${label}</button>`;
  return `<div class="numpad">
    ${showPreview ? `<div class="numpad-preview">= ${fmtMoney(preview)}</div>` : ''}
    <div class="numpad-grid">
      ${k('7','7')}${k('8','8')}${k('9','9')}${k('back','⌫','back')}
      ${k('4','4')}${k('5','5')}${k('6','6')}${k('+','+','op')}
      ${k('1','1')}${k('2','2')}${k('3','3')}${k('-','−','op')}
      ${k('0','0','zero')}${k(',',',','comma')}
    </div>
  </div>`;
}

function renderRecent(){
  const exp = state.expenses.map(e=>Object.assign({_t:'expense'}, e));
  const inc = state.income.map(e=>Object.assign({_t:'income'}, e));
  const all = exp.concat(inc).sort((a,b)=> (b.date+'_'+(b.createdAt||0)) > (a.date+'_'+(a.createdAt||0)) ? 1 : -1).slice(0,8);
  if(all.length===0){
    return `<div class="card"><div class="empty-state"><span class="ic">🧾</span>Brak zapisanych wpisów.<br>Dodaj pierwszy powyżej.</div></div>`;
  }
  return `<div class="card"><h2>Ostatnie wpisy</h2><div class="tx-list">${all.map(rowHtml).join('')}</div></div>`;
}

function rowHtml(e){
  const isInc = e._t==='income';
  const c = isInc ? (INC_BY_ID[e.srcId] || {icon:'💰',color:'#4F9D8C',name:'Przychód'})
                  : (CAT_BY_ID[e.catId] || {icon:'📦',color:'#888',name:'Inne'});
  const d = parseYmd(e.date);
  const dateLbl = d.getDate()+' '+MONTHS_GEN[d.getMonth()];
  const label = isInc ? (c.name) : (e.sub || c.name);
  const sp = !isInc ? splitParts(e) : null;
  const tags = (e.auto ? '<span class="tag">🔁</span>' : '') + (sp ? '<span class="tag">🤝</span>' : '');
  const amountCls = isInc ? 'tx-amount pos' : 'tx-amount';
  const amountTxt = (isInc?'+ ':'') + fmtMoney(e.amount);
  return `<div class="tx-swipe">
    <div class="tx-swipe-action"><button data-act="swipedel" data-id="${e.id}" data-t="${e._t}">Usuń</button></div>
    <div class="tx-swipe-content" data-act="editrow" data-id="${e.id}" data-t="${e._t}">
      <div class="tx-ic" style="background:${c.color}33;color:${c.color}">${c.icon}</div>
      <div class="tx-main">
        <div class="tx-sub">${escapeHtml(label)} ${tags}</div>
        <div class="tx-meta">${dateLbl}${e.note ? ' · '+escapeHtml(e.note) : ''}${sp ? ' · '+state.friendName+' oddaje '+fmtMoney(sp.friend) : ''}</div>
      </div>
      <div class="${amountCls}">${amountTxt}</div>
      <button class="tx-del" data-act="delrow" data-id="${e.id}" data-t="${e._t}" title="Usuń" aria-label="Usuń">✕</button>
    </div>
  </div>`;
}

/* ============ RENDER: MONTH ============ */
function renderMonth(){
  const {y,m} = state.cursor;
  const listAll = monthExpenses(y,m).sort((a,b)=> a.date===b.date ? 0 : (a.date<b.date?1:-1));
  const total = sum(listAll);
  const incTotal = sum(monthIncome(y,m));
  const balance = incTotal - total;

  const prevD = new Date(y,m-1,1); const prevTotal = sum(monthExpenses(prevD.getFullYear(), prevD.getMonth()));
  let deltaHtml = '';
  if(prevTotal>0){
    const diff = ((total-prevTotal)/prevTotal)*100;
    const cls = diff>0 ? 'delta-up' : 'delta-down';
    const arrow = diff>0 ? '↑' : '↓';
    deltaHtml = `<span class="${cls}">${arrow} ${Math.abs(diff).toFixed(0)}%</span> vs poprz. miesiąc`;
  }

  const days = new Set(listAll.map(e=>e.date)).size;
  const avgDay = days>0 ? total/days : 0;
  const cats = catTotals(listAll);
  const topCat = cats[0];

  // Budget hero
  let hero = '';
  if(state.budget && state.budget>0){
    const pct = total/state.budget;
    const remaining = state.budget - total;
    const ringColor = pct<0.8 ? 'var(--accent-2)' : (pct<=1 ? 'var(--accent)' : 'var(--danger)');
    const stateLbl = pct<0.8 ? 'w normie' : (pct<=1 ? 'blisko limitu' : 'przekroczony');
    hero = `<div class="card budget-hero">
      ${donutRing(Math.min(pct,1), ringColor, Math.round(Math.min(pct,9.99)*100)+'%', stateLbl)}
      <div class="bh-info">
        <div class="bh-big">${fmtMoney(total)}</div>
        <div class="bh-sub">z ${fmtMoney(state.budget)} budżetu</div>
        <div class="bh-remain ${remaining>=0?'ok':'over'}">${remaining>=0 ? 'Zostało '+fmtMoney(remaining) : 'Ponad budżet o '+fmtMoney(-remaining)}</div>
      </div>
    </div>`;
  } else {
    hero = `<div class="card budget-hero empty" data-act="gotobudget">
      <div class="bh-info">
        <div class="bh-big" style="font-size:17px;">Ustaw budżet miesięczny</div>
        <div class="bh-sub">Zobaczysz pierścień postępu i ile jeszcze możesz wydać →</div>
      </div>
    </div>`;
  }

  // Category breakdown with per-category budget bars
  const catRows = cats.map(c=>{
    const pct = total>0 ? (c.total/total*100) : 0;
    const cb = state.categoryBudgets[c.id];
    let budgetBar = '';
    if(cb && cb>0){
      const bp = Math.min(c.total/cb,1)*100;
      const over = c.total>cb;
      budgetBar = `<div class="cat-budget-bar"><i style="width:${bp}%;background:${over?'var(--danger)':c.color}"></i></div>
        <div class="cat-budget-lbl ${over?'over':''}">${fmtMoney(c.total)} / ${fmtMoney(cb)}</div>`;
    }
    return `<div class="cat-list-row clickable" data-act="filtercat" data-id="${c.id}">
      <span class="dot" style="background:${c.color}"></span>
      <span class="name">${escapeHtml(c.name)}${budgetBar?'<div class="cat-budget-wrap">'+budgetBar+'</div>':''}</span>
      <span class="pct">${pct.toFixed(0)}%</span>
      <span class="amt">${fmtMoney(c.total)}</span>
    </div>`;
  }).join('');

  // Filtered + searched entries
  const q = state.searchQuery.trim().toLowerCase();
  let list = listAll;
  if(state.filterCatId) list = list.filter(e=>e.catId===state.filterCatId);
  if(q){
    list = list.filter(e=>{
      const hay = ((e.sub||'')+' '+(e.note||'')+' '+e.amount).toLowerCase();
      return hay.includes(q);
    });
  }
  const filterActive = state.filterCatId || q;

  const filterChips = cats.map(c=>`<button class="fchip ${state.filterCatId===c.id?'sel':''}" style="--cat-color:${c.color}" data-act="filtercat" data-id="${c.id}">${(CAT_BY_ID[c.id]||{}).icon||'📦'} ${escapeHtml(c.name)}</button>`).join('');

  let listHtml = '';
  let lastDate = null;
  list.forEach(e=>{
    if(e.date !== lastDate){
      const d = parseYmd(e.date);
      listHtml += `<div class="day-header">${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS_GEN[d.getMonth()]}</div>`;
      lastDate = e.date;
    }
    listHtml += rowHtml(Object.assign({_t:'expense'}, e));
  });
  if(list.length===0){
    listHtml = filterActive
      ? `<div class="empty-state"><span class="ic">🔍</span>Brak wpisów pasujących do filtra.</div>`
      : `<div class="empty-state"><span class="ic">📭</span>Brak wydatków w tym miesiącu.</div>`;
  }

  return `
  <div class="period-nav">
    <button data-act="monthnav" data-dir="-1">‹</button>
    <div class="label">${MONTHS_NOM[m]} ${y}</div>
    <button data-act="monthnav" data-dir="1">›</button>
  </div>
  ${hero}
  <div class="card">
    <div class="stat-grid three">
      <div class="stat-box"><div class="v">${fmtMoney(total)}</div><div class="l">Wydatki</div></div>
      <div class="stat-box"><div class="v pos">${fmtMoney(incTotal)}</div><div class="l">Przychody</div></div>
      <div class="stat-box"><div class="v ${balance>=0?'pos':'neg'}">${fmtSigned(balance)}</div><div class="l">Bilans</div></div>
    </div>
    <div class="muted" style="margin-top:8px;">${deltaHtml || 'Brak danych z poprzedniego miesiąca'} · śr. ${fmtMoney(avgDay)}/dzień${topCat ? ' · najwięcej: '+escapeHtml(topCat.name) : ''}</div>
  </div>
  <div class="card">
    <h2>Podział na kategorie</h2>
    <div class="donut-wrap">
      ${cats.length ? donutChart(cats) : ''}
      <div class="cat-list">${catRows || '<div class="muted">Brak danych.</div>'}</div>
    </div>
  </div>
  <div class="card">
    <h2>Wpisy</h2>
    <div class="search-box">
      <span class="si">🔍</span>
      <input id="searchInput" type="text" placeholder="Szukaj po nazwie, notatce, kwocie…" value="${escapeHtml(state.searchQuery)}">
      ${state.searchQuery ? '<button class="clear" data-act="clearsearch">✕</button>' : ''}
    </div>
    ${cats.length>1 ? `<div class="filter-chips">${filterChips}${state.filterCatId?'<button class="fchip clear" data-act="clearfilter">✕ wyczyść</button>':''}</div>` : ''}
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
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--ring-track)" stroke-width="${stroke}"/>
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
  const incTotal = sum(yearIncome(y));
  const balance = incTotal - total;
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

  const expByMonth = Array.from({length:12},(_,m)=> sum(monthExpenses(y,m)));
  const incByMonth = Array.from({length:12},(_,m)=> sum(monthIncome(y,m)));
  const max = Math.max(...expByMonth, ...incByMonth, 1);
  const bars = expByMonth.map((v,m)=>{
    const he = Math.max((v/max)*100, v>0?3:0);
    const hi = Math.max((incByMonth[m]/max)*100, incByMonth[m]>0?3:0);
    const isCur = (y===today.getFullYear() && m===today.getMonth());
    return `<div class="bar-col">
      <div class="bar-pair">
        <div class="bar inc ${isCur?'current':''}" style="height:${hi}%" title="Przychód ${MONTHS_NOM[m]}: ${fmtMoney(incByMonth[m])}"></div>
        <div class="bar ${isCur?'current':''}" style="height:${he}%" title="Wydatki ${MONTHS_NOM[m]}: ${fmtMoney(v)}"></div>
      </div>
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
    <div class="stat-grid three">
      <div class="stat-box"><div class="v">${fmtMoney(total)}</div><div class="l">Wydatki</div></div>
      <div class="stat-box"><div class="v pos">${fmtMoney(incTotal)}</div><div class="l">Przychody</div></div>
      <div class="stat-box"><div class="v ${balance>=0?'pos':'neg'}">${fmtSigned(balance)}</div><div class="l">Bilans</div></div>
    </div>
    <div class="muted" style="margin-top:8px;">${deltaHtml || 'Brak danych z poprzedniego roku'} · śr. wydatki ${fmtMoney(avgMonth)}/mies.</div>
  </div>
  <div class="card">
    <h2>Miesiąc po miesiącu</h2>
    <div class="legend"><span><i class="lg" style="background:var(--accent-2)"></i>Przychody</span><span><i class="lg" style="background:var(--accent)"></i>Wydatki</span></div>
    <div class="bar-chart">${bars}</div>
  </div>
  <div class="card">
    <h2>Kategorie w ${y} roku</h2>
    ${cats.length ? `<table class="cat-table">${catRows}</table>` : '<div class="muted">Brak danych dla tego roku.</div>'}
  </div>
  `;
}

/* ============ RENDER: SHARED (split costs) ============ */
function renderShared(){
  const {y,m} = state.splitCursor;
  const shared = monthExpenses(y,m).filter(e=>e.split && e.split.enabled)
    .sort((a,b)=> a.date<b.date?1:-1);
  let friendTotal=0, myTotal=0, grand=0;
  shared.forEach(e=>{ const p=splitParts(e); friendTotal+=p.friend; myTotal+=p.mine; grand+=e.amount; });

  const rows = shared.map(e=>{
    const p = splitParts(e);
    const c = CAT_BY_ID[e.catId] || {icon:'📦',color:'#888',name:'Inne'};
    const d = parseYmd(e.date);
    return `<div class="tx-swipe">
      <div class="tx-swipe-action"><button data-act="swipedel" data-id="${e.id}" data-t="expense">Usuń</button></div>
      <div class="tx-swipe-content" data-act="editrow" data-id="${e.id}" data-t="expense">
        <div class="tx-ic" style="background:${c.color}33;color:${c.color}">${c.icon}</div>
        <div class="tx-main">
          <div class="tx-sub">${escapeHtml(e.sub||c.name)}</div>
          <div class="tx-meta">${d.getDate()} ${MONTHS_GEN[d.getMonth()]} · całość ${fmtMoney(e.amount)} · Twoje ${fmtMoney(p.mine)}</div>
        </div>
        <div class="tx-amount pos">${fmtMoney(p.friend)}</div>
      </div>
    </div>`;
  }).join('');

  return `
  <div class="period-nav">
    <button data-act="splitnav" data-dir="-1">‹</button>
    <div class="label">${MONTHS_NOM[m]} ${y}</div>
    <button data-act="splitnav" data-dir="1">›</button>
  </div>
  <div class="card settle-card">
    <div class="settle-head">🤝 Rozliczenie z: <b>${escapeHtml(state.friendName)}</b></div>
    ${shared.length ? `
      <div class="settle-big ${friendTotal>0?'owed':''}">${state.friendName} oddaje Ci<br><b>${fmtMoney(friendTotal)}</b></div>
      <div class="settle-grid">
        <div><span class="l">Wspólne wydatki</span><span class="v">${fmtMoney(grand)}</span></div>
        <div><span class="l">Twoja część</span><span class="v">${fmtMoney(myTotal)}</span></div>
        <div><span class="l">Część ${escapeHtml(state.friendName)}</span><span class="v pos">${fmtMoney(friendTotal)}</span></div>
      </div>
      <div class="settle-note muted">Zakłada, że to Ty płaciłeś za wspólne zakupy. Po rozliczeniu po prostu przejdź do kolejnego miesiąca.</div>
    ` : `<div class="empty-state"><span class="ic">🤝</span>Brak wspólnych wydatków w tym miesiącu.<br>Oznacz wydatek jako „wspólny" przy dodawaniu.</div>`}
  </div>
  ${shared.length ? `<div class="card"><h2>Wspólne wydatki</h2><div class="tx-list">${rows}</div></div>` : ''}
  <div class="card hint-card">
    <div class="muted"><b>Jak to działa?</b> Każdy prowadzi własną księgę. Tu widzisz, ile znajomy jest Ci winien za zakupy, które <i>Ty</i> opłaciłeś i oznaczyłeś jako wspólne. Pełne dwustronne rozliczenie (wspólne konto gospodarstwa) to naturalny kolejny krok, gdyby aplikacja miała iść szerzej.</div>
  </div>
  `;
}

/* ============ RENDER: SETTINGS ============ */
function renderSettings(){
  const count = state.expenses.length + state.income.length;
  const oldest = state.expenses.length ? state.expenses.reduce((a,e)=> e.date<a.date?e:a).date : null;

  const catBudgetRows = CATEGORIES.map(c=>{
    const v = state.categoryBudgets[c.id];
    return `<div class="catbudget-row">
      <span class="cb-name">${c.icon} ${escapeHtml(c.name)}</span>
      <div class="cb-input-wrap">
        <input class="num-input small" data-act="catbudget" data-id="${c.id}" type="text" inputmode="decimal" placeholder="—" value="${v?String(v).replace('.',','):''}">
        <span class="cb-cur">zł</span>
      </div>
    </div>`;
  }).join('');

  const recRows = state.recurring.length ? state.recurring.map(r=>{
    const isInc = r.type==='income';
    const c = isInc ? (INC_BY_ID[r.catId]||{icon:'💰',name:'Przychód'}) : (CAT_BY_ID[r.catId]||{icon:'📦',name:'Inne'});
    const label = isInc ? c.name : (r.sub||c.name);
    return `<div class="rec-row ${r.active?'':'off'}">
      <div class="rec-ic">${c.icon}</div>
      <div class="rec-main">
        <div class="rec-title">${escapeHtml(label)} ${isInc?'<span class="tag pos">przychód</span>':''}</div>
        <div class="rec-meta">${fmtMoney(r.amount)} · ${r.dayOfMonth}. dnia miesiąca${r.note?' · '+escapeHtml(r.note):''}</div>
      </div>
      <button class="switch ${r.active?'on':''}" data-act="rectoggle" data-id="${r.id}" aria-pressed="${r.active}"><i></i></button>
      <button class="rec-del" data-act="recdel" data-id="${r.id}" aria-label="Usuń">✕</button>
    </div>`;
  }).join('') : '<div class="muted" style="padding:4px 0 8px;">Brak płatności cyklicznych. Dodaj pierwszą poniżej.</div>';

  return `
  <div class="card">
    <h2>Wygląd</h2>
    <div class="settings-row col">
      <div><div class="t">Motyw</div><div class="d">Ciemny jest domyślny. Wybór zapisuje się na tym urządzeniu.</div></div>
      <div class="seg theme-seg">
        <button class="${state.theme==='dark'?'active':''}" data-act="theme" data-val="dark">🌙 Ciemny</button>
        <button class="${state.theme==='light'?'active':''}" data-act="theme" data-val="light">☀️ Jasny</button>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>Budżet miesięczny</h2>
    <div class="settings-row">
      <div><div class="t">Łączny limit na miesiąc</div><div class="d">Pierścień postępu na górze widoku „Miesiąc" - synchronizuje się między urządzeniami</div></div>
      <div class="cb-input-wrap">
        <input class="num-input" id="budgetInput" type="text" inputmode="decimal" placeholder="np. 3000" value="${state.budget ? String(state.budget).replace('.',',') : ''}">
        <span class="cb-cur">zł</span>
      </div>
    </div>
    <button class="btn accent" id="saveBudgetBtn" style="margin-top:8px;">Zapisz budżet</button>
  </div>

  <div class="card">
    <h2>Budżety per kategoria</h2>
    <div class="muted" style="margin-bottom:10px;">Ustaw limit dla wybranych kategorii. Puste pole = brak limitu. Postęp widać w „Miesiącu".</div>
    <div class="catbudget-list">${catBudgetRows}</div>
    <button class="btn accent" id="saveCatBudgetsBtn" style="margin-top:12px;">Zapisz limity kategorii</button>
  </div>

  <div class="card">
    <h2>Płatności cykliczne</h2>
    <div class="muted" style="margin-bottom:10px;">Czynsz, abonamenty, pensja - tworzą się automatycznie raz w miesiącu w wskazanym dniu.</div>
    <div class="rec-list">${recRows}</div>
    ${renderRecForm()}
  </div>

  <div class="card">
    <h2>Wspólne wydatki</h2>
    <div class="settings-row">
      <div><div class="t">Imię osoby do rozliczeń</div><div class="d">Pojawia się w zakładce „Wspólne" i przy oznaczaniu wydatku</div></div>
      <input class="num-input wide" id="friendNameInput" type="text" maxlength="24" placeholder="np. Sebastian" value="${escapeHtml(state.friendName==='Znajomy'?'':state.friendName)}">
    </div>
    <button class="btn accent" id="saveFriendBtn" style="margin-top:8px;">Zapisz</button>
  </div>

  <div class="card">
    <h2>Dane</h2>
    <div class="settings-row">
      <div><div class="t">Zapisanych wpisów</div><div class="d">${count} wpisów${oldest ? ', od '+escapeHtml(oldest) : ''}</div></div>
    </div>
    <div class="settings-row">
      <div><div class="t">Eksportuj dane</div><div class="d">Kopia zapasowa jako plik JSON (wydatki + przychody)</div></div>
      <button class="btn" id="exportBtn">Eksportuj</button>
    </div>
    <div class="settings-row">
      <div><div class="t">Importuj dane</div><div class="d">Dodaj wpisy z pliku JSON</div></div>
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
      Apka działa offline - dodawanie, edycja i usuwanie wpisów zawsze działają lokalnie, nawet bez internetu.
      Gdy urządzenie złapie sieć, zmiany synchronizują się automatycznie ze wszystkimi Twoimi urządzeniami przez Firebase.
    </div>
  </div>
  `;
}

function renderRecForm(){
  const d = state.recDraft;
  if(!d){
    return `<button class="btn" id="recAddBtn" style="margin-top:10px;">+ Dodaj płatność cykliczną</button>`;
  }
  const isInc = d.type==='income';
  const cats = isInc ? INCOME_CATS : CATEGORIES;
  const catOpts = cats.map(c=>`<option value="${c.id}" ${c.id===d.catId?'selected':''}>${c.icon} ${escapeHtml(c.name)}</option>`).join('');
  const subList = (!isInc && CAT_BY_ID[d.catId]) ? CAT_BY_ID[d.catId].subs : [];
  const subOpts = subList.map(s=>`<option value="${escapeHtml(s)}" ${s===d.sub?'selected':''}>${escapeHtml(s)}</option>`).join('');
  return `<div class="rec-form">
    <div class="seg small">
      <button class="${!isInc?'active':''}" data-act="rectype" data-val="expense">Wydatek</button>
      <button class="${isInc?'active income':''}" data-act="rectype" data-val="income">Przychód</button>
    </div>
    <div class="rf-grid">
      <label>Kwota<input class="num-input" id="recAmount" type="text" inputmode="decimal" placeholder="0,00" value="${d.amount?String(d.amount).replace('.',','):''}"></label>
      <label>Dzień miesiąca<input class="num-input" id="recDay" type="number" min="1" max="28" value="${d.dayOfMonth||1}"></label>
    </div>
    <label class="rf-full">Kategoria
      <select id="recCat">${catOpts}</select>
    </label>
    ${!isInc ? `<label class="rf-full">Podkategoria<select id="recSub">${subOpts}</select></label>` : ''}
    <label class="rf-full">Notatka<input class="note-input dark" id="recNote" type="text" maxlength="80" placeholder="np. Netflix" value="${escapeHtml(d.note||'')}"></label>
    <div class="rf-actions">
      <button class="btn" id="recCancelBtn">Anuluj</button>
      <button class="btn accent" id="recSaveBtn">Zapisz</button>
    </div>
  </div>`;
}

/* ============ EVENTS ============ */
function attachHandlers(){
  document.getElementById('tabs').onclick = (ev)=>{
    const btn = ev.target.closest('button[data-view]');
    if(!btn) return;
    if(state.view==='add'){ stashDrafts(); }
    state.view = btn.dataset.view;
    state.numpadOpen = false;
    render();
  };

  const view = document.getElementById('view');
  view.onclick = null;

  if(state.view==='add') attachAdd(view);
  else if(state.view==='month') attachMonth(view);
  else if(state.view==='year') attachYear(view);
  else if(state.view==='shared') attachShared(view);
  else if(state.view==='settings') attachSettings(view);

  attachSwipe();
}

function stashDrafts(){
  const a=document.getElementById('amountInput'); if(a) state._amountDraft=a.value;
  const n=document.getElementById('noteInput'); if(n) state._noteDraft=n.value;
}

function attachAdd(view){
  const amountEl = document.getElementById('amountInput');
  const noteEl = document.getElementById('noteInput');
  const dateEl = document.getElementById('dateInput');

  if(amountEl){
    fitAmountField(amountEl);
    if(!state.numpadOpen){
      amountEl.addEventListener('input', ()=>{
        const clean = sanitizeAmount(amountEl.value);
        if(clean !== amountEl.value) amountEl.value = clean;
        state._amountDraft = clean;
        fitAmountField(amountEl);
        updateSaveState();
      });
      amountEl.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ attemptSave(); } });
    }
  }
  if(noteEl){
    noteEl.addEventListener('input', ()=>{ state._noteDraft = noteEl.value; });
    noteEl.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ attemptSave(); } });
  }
  if(dateEl) dateEl.addEventListener('change', ()=>{ state.selDate = dateEl.value; render(); });

  const shareEl = document.getElementById('shareInput');
  if(shareEl) shareEl.addEventListener('input', ()=>{ let v=parseInt(shareEl.value,10); if(isNaN(v))return; v=Math.max(1,Math.min(100,v)); state.splitShare=v; });

  view.onclick = (ev)=>{
    const t = ev.target.closest('[data-act]');
    if(!t) return;
    const act = t.dataset.act;
    if(act==='mode'){
      stashDrafts(); state.addMode=t.dataset.val; state.selCatId=null; state.selSub=null; state.editId=null; state.numpadOpen=false; render();
    } else if(act==='pickcat'){
      stashDrafts(); state.selCatId=t.dataset.id; state.selSub=null; render();
    } else if(act==='picksub'){
      state.selSub=t.dataset.sub; render();
      setTimeout(()=>{ const a=document.getElementById('amountInput'); if(a && !state.numpadOpen){ a.focus(); a.select(); } },0);
    } else if(act==='pickinc'){
      stashDrafts(); state.selCatId=t.dataset.id; render();
    } else if(act==='changecat'){
      state.selSub=null; render();
    } else if(act==='setdate'){
      stashDrafts(); state.selDate=t.dataset.val; render();
    } else if(act==='togglenumpad'){
      stashDrafts(); state.numpadOpen=!state.numpadOpen; render();
    } else if(act==='np'){
      handleNumpad(t.dataset.k);
    } else if(act==='togglesplit'){
      stashDrafts(); state.splitOn=!state.splitOn; render();
    } else if(act==='setshare'){
      state.splitShare=parseInt(t.dataset.val,10); render();
    } else if(act==='editrow'){
      startEdit(t.dataset.id, t.dataset.t);
    } else if(act==='delrow' || act==='swipedel'){
      ev.stopPropagation(); confirmDelete(t.dataset.id, t.dataset.t);
    }
  };

  const saveBtn=document.getElementById('saveBtn');
  if(saveBtn) saveBtn.addEventListener('click', attemptSave);
  const cancelBtn = document.getElementById('cancelEditBtn');
  if(cancelBtn) cancelBtn.addEventListener('click', cancelEdit);
}

function attachMonth(view){
  view.onclick = (ev)=>{
    const t = ev.target.closest('[data-act]');
    if(!t) return;
    const act=t.dataset.act;
    if(act==='monthnav') shiftMonth(parseInt(t.dataset.dir,10));
    else if(act==='editrow') startEdit(t.dataset.id, t.dataset.t);
    else if(act==='delrow' || act==='swipedel'){ ev.stopPropagation(); confirmDelete(t.dataset.id, t.dataset.t); }
    else if(act==='filtercat'){ state.filterCatId = state.filterCatId===t.dataset.id ? null : t.dataset.id; render(); }
    else if(act==='clearfilter'){ state.filterCatId=null; render(); }
    else if(act==='clearsearch'){ state.searchQuery=''; render(); }
    else if(act==='gotobudget'){ state.view='settings'; render(); }
  };
  const search=document.getElementById('searchInput');
  if(search){
    search.addEventListener('input', ()=>{ state.searchQuery=search.value; updateMonthList(); });
  }
}

/* Lightweight search update without full re-render, to keep focus in the input. */
function updateMonthList(){
  // Re-render only is simplest but loses focus; instead re-render whole view and refocus.
  const pos = (document.getElementById('searchInput')||{}).selectionStart;
  render();
  const s=document.getElementById('searchInput');
  if(s){ s.focus(); try{ s.setSelectionRange(pos,pos); }catch(e){} }
}

function attachYear(view){
  view.onclick = (ev)=>{
    const t = ev.target.closest('[data-act]');
    if(!t) return;
    if(t.dataset.act==='yearnav'){ state.yearCursor += parseInt(t.dataset.dir,10); ensureWindow(); render(); }
  };
}

function attachShared(view){
  view.onclick = (ev)=>{
    const t = ev.target.closest('[data-act]');
    if(!t) return;
    const act=t.dataset.act;
    if(act==='splitnav'){ shiftSplit(parseInt(t.dataset.dir,10)); }
    else if(act==='editrow'){ startEdit(t.dataset.id, t.dataset.t); }
    else if(act==='swipedel'){ ev.stopPropagation(); confirmDelete(t.dataset.id, t.dataset.t); }
  };
}

function attachSettings(view){
  view.onclick = (ev)=>{
    const t = ev.target.closest('[data-act]');
    if(!t) return;
    const act=t.dataset.act;
    if(act==='theme'){ setTheme(t.dataset.val); }
    else if(act==='rectoggle'){ const r=state.recurring.find(x=>x.id===t.dataset.id); if(r) dataLayer.updateRecurring(r.id,{active:!r.active}); }
    else if(act==='recdel'){ confirmDeleteRecurring(t.dataset.id); }
    else if(act==='rectype'){ if(state.recDraft){ state.recDraft.type=t.dataset.val; state.recDraft.catId = t.dataset.val==='income'?INCOME_CATS[0].id:CATEGORIES[0].id; state.recDraft.sub=null; render(); } }
  };

  const sb=document.getElementById('saveBudgetBtn');
  if(sb) sb.addEventListener('click', ()=>{
    const v = parseAmountInput(document.getElementById('budgetInput').value);
    const nb = (v>0)?v:null;
    dataLayer.setSettings({budget:nb}).then(()=>showToast(nb?'Budżet zapisany':'Budżet usunięty')).catch(err=>{console.error(err);showToast('Nie udało się zapisać budżetu');});
  });

  const scb=document.getElementById('saveCatBudgetsBtn');
  if(scb) scb.addEventListener('click', ()=>{
    const map={};
    view.querySelectorAll('input[data-act="catbudget"]').forEach(inp=>{
      const v=parseAmountInput(inp.value);
      if(v>0) map[inp.dataset.id]=v;
    });
    dataLayer.setSettings({categoryBudgets:map}).then(()=>showToast('Limity kategorii zapisane')).catch(err=>{console.error(err);showToast('Nie udało się zapisać');});
  });

  const fb=document.getElementById('saveFriendBtn');
  if(fb) fb.addEventListener('click', ()=>{
    const name=(document.getElementById('friendNameInput').value||'').trim() || 'Znajomy';
    dataLayer.setSettings({friendName:name}).then(()=>showToast('Zapisano')).catch(err=>{console.error(err);showToast('Nie udało się zapisać');});
  });

  document.getElementById('exportBtn').addEventListener('click', exportData);
  document.getElementById('importBtn').addEventListener('click', ()=> document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', importData);
  document.getElementById('signOutBtn').addEventListener('click', ()=>{
    showConfirm('Wylogować z tego urządzenia?', ()=>{ dataLayer.signOut(); }, 'Wyloguj');
  });

  // recurring form
  const recAddBtn=document.getElementById('recAddBtn');
  if(recAddBtn) recAddBtn.addEventListener('click', ()=>{ state.recDraft={type:'expense',amount:'',catId:CATEGORIES[0].id,sub:CATEGORIES[0].subs[0],dayOfMonth:1,note:''}; render(); });
  const recCancelBtn=document.getElementById('recCancelBtn');
  if(recCancelBtn) recCancelBtn.addEventListener('click', ()=>{ state.recDraft=null; render(); });
  const recCatEl=document.getElementById('recCat');
  if(recCatEl) recCatEl.addEventListener('change', ()=>{ state.recDraft.catId=recCatEl.value; if(state.recDraft.type==='expense'){ state.recDraft.sub=(CAT_BY_ID[recCatEl.value]||{subs:['']}).subs[0]; } render(); });
  const recSubEl=document.getElementById('recSub');
  if(recSubEl) recSubEl.addEventListener('change', ()=>{ state.recDraft.sub=recSubEl.value; });
  const recSaveBtn=document.getElementById('recSaveBtn');
  if(recSaveBtn) recSaveBtn.addEventListener('click', saveRecurring);
  // keep draft fields synced on input
  ['recAmount','recDay','recNote'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.addEventListener('input', ()=>{
      if(id==='recAmount') state.recDraft.amount=el.value;
      else if(id==='recDay') state.recDraft.dayOfMonth=parseInt(el.value,10)||1;
      else state.recDraft.note=el.value;
    });
  });
}

/* ============ NUMPAD ============ */
function handleNumpad(k){
  let cur = state._amountDraft || '';
  if(k==='back'){
    cur = cur.slice(0,-1);
  } else if(k===','){
    const seg = cur.split(/[+\-]/).pop();
    if(seg!=='' && seg.indexOf(',')===-1) cur += ',';
  } else if(k==='+'||k==='-'){
    if(cur && !/[+\-]$/.test(cur)) cur += k;
  } else {
    // cyfra: pilnuj max 2 miejsc po przecinku i limitu kwoty w segmencie
    const seg = cur.split(/[+\-]/).pop();
    const ci = seg.indexOf(',');
    if(ci!==-1){
      if(seg.length-ci-1 >= 2) return; // już 2 cyfry po przecinku
    } else if(seg.replace(/^0+(?=\d)/,'').length >= MAX_INT_DIGITS){
      return; // 8 cyfr części całkowitej = 10 000 000
    }
    const candidate = seg + k;
    if(parseFloat(candidate.replace(',','.')) > MAX_AMOUNT) return;
    cur += k;
  }
  cur = sanitizeAmount(cur);
  state._amountDraft = cur;
  const inp=document.getElementById('amountInput');
  if(inp){ inp.value=cur; fitAmountField(inp); }
  const np=document.querySelector('.numpad');
  if(np) np.outerHTML = renderNumpad(cur);
  updateSaveState();
}

/* ============ SWIPE ============ */
/* Przesunięcie palcem w lewo poza próg od razu wywołuje pop-up potwierdzenia
   (bez drugiego klikania osobnego przycisku). Wiersz zawsze wraca na miejsce. */
function attachSwipe(){
  const THRESHOLD = -64;
  document.querySelectorAll('.tx-swipe-content').forEach(el=>{
    let startX=0, startY=0, dx=0, active=false, decided=false, horizontal=false, fired=false;
    const reset = ()=>{ el.style.transition='transform .18s'; el.style.transform='translateX(0)'; };
    el.addEventListener('touchstart', e=>{
      startX=e.touches[0].clientX; startY=e.touches[0].clientY;
      dx=0; active=true; decided=false; horizontal=false; fired=false;
      el.style.transition='none';
    }, {passive:true});
    el.addEventListener('touchmove', e=>{
      if(!active || fired) return;
      const ddx=e.touches[0].clientX-startX, ddy=e.touches[0].clientY-startY;
      if(!decided && (Math.abs(ddx)>8 || Math.abs(ddy)>8)){ decided=true; horizontal=Math.abs(ddx)>Math.abs(ddy); }
      if(!horizontal) return;
      dx = Math.max(-110, Math.min(0, ddx));
      el.style.transform='translateX('+dx+'px)';
      el.parentElement.classList.toggle('arming', dx < THRESHOLD);
      if(dx < THRESHOLD){
        // commit od razu po przekroczeniu progu
        fired=true; active=false;
        el.parentElement.classList.remove('arming');
        reset();
        confirmDelete(el.dataset.id, el.dataset.t);
      }
    }, {passive:true});
    el.addEventListener('touchend', ()=>{
      if(!active) return; active=false;
      el.parentElement.classList.remove('arming');
      reset();
    });
  });
}

function updateSaveState(){
  const amountEl = document.getElementById('amountInput');
  const btn = document.getElementById('saveBtn');
  if(!btn || !amountEl) return;
  const need = state.addMode==='income' ? state.selCatId : state.selSub;
  const ok = evalAmountExpr(amountEl.value) > 0 && need;
  btn.disabled = !ok;
}

/* ============ SAVE / EDIT / DELETE ============ */
function attemptSave(){
  const amountEl = document.getElementById('amountInput');
  const noteEl = document.getElementById('noteInput');
  const amount = evalAmountExpr(amountEl.value);
  if(!(amount>0)){ if(!state.numpadOpen) amountEl.focus(); showToast('Wpisz poprawną kwotę'); return; }
  if(amount>MAX_AMOUNT){ showToast('Maksymalna kwota to 10 000 000 zł'); return; }

  if(state.addMode==='income'){
    if(!state.selCatId){ showToast('Wybierz źródło przychodu'); return; }
    const payload = { amount, srcId: state.selCatId, date: state.selDate, note: noteEl.value.trim() };
    if(state.editId && state.editType==='income'){
      dataLayer.updateIncome(state.editId, payload).then(()=>showToast('Zmiany zapisane')).catch(err=>{console.error(err);showToast('Nie udało się zapisać zmian');});
      state.editId=null; state.editType=null;
    } else {
      dataLayer.addIncome(Object.assign({createdAt:Date.now()}, payload)).then(()=>showToast('Zapisano przychód: '+fmtMoney(amount))).catch(err=>{console.error(err);showToast('Nie udało się zapisać - sprawdź połączenie');});
    }
  } else {
    if(!state.selCatId || !state.selSub){ showToast('Wybierz kategorię wydatku'); return; }
    const payload = { amount, catId: state.selCatId, sub: state.selSub, date: state.selDate, note: noteEl.value.trim() };
    if(state.splitOn){ payload.split = { enabled:true, share: state.splitShare/100, payer:'me' }; }
    else { payload.split = { enabled:false }; }
    if(state.editId && state.editType==='expense'){
      dataLayer.updateExpense(state.editId, payload).then(()=>showToast('Zmiany zapisane')).catch(err=>{console.error(err);showToast('Nie udało się zapisać zmian');});
      state.editId=null; state.editType=null;
    } else {
      dataLayer.addExpense(Object.assign({createdAt:Date.now()}, payload)).then(()=>showToast('Zapisano: '+fmtMoney(amount)+' - '+state.selSub)).catch(err=>{console.error(err);showToast('Nie udało się zapisać - sprawdź połączenie');});
    }
  }

  state._amountDraft=''; state._noteDraft='';
  state.splitOn=false; state.splitShare=50;
  render();
  setTimeout(()=>{ const a=document.getElementById('amountInput'); if(a && !state.numpadOpen) a.focus(); },0);
}

function startEdit(id, type){
  if(type==='income'){
    const ex = state.income.find(e=>e.id===id);
    if(!ex) return;
    state.addMode='income'; state.editId=id; state.editType='income';
    state.selCatId=ex.srcId; state.selSub=null; state.selDate=ex.date;
    state._amountDraft=String(ex.amount).replace('.',','); state._noteDraft=ex.note||'';
  } else {
    const ex = state.expenses.find(e=>e.id===id);
    if(!ex) return;
    state.addMode='expense'; state.editId=id; state.editType='expense';
    state.selCatId=ex.catId; state.selSub=ex.sub; state.selDate=ex.date;
    state._amountDraft=String(ex.amount).replace('.',','); state._noteDraft=ex.note||'';
    state.splitOn = !!(ex.split && ex.split.enabled);
    state.splitShare = state.splitOn ? Math.round((ex.split.share||0.5)*100) : 50;
  }
  state.numpadOpen=false;
  state.view='add';
  render();
  if(typeof window!=='undefined' && window.scrollTo) window.scrollTo({top:0, behavior:'smooth'});
}

function cancelEdit(){
  state.editId=null; state.editType=null;
  state.selCatId=null; state.selSub=null;
  state._amountDraft=''; state._noteDraft='';
  state.splitOn=false; state.splitShare=50;
  state.selDate=ymd(today);
  render();
}

function confirmDelete(id, type){
  const verb = type==='income' ? 'przychód' : 'wydatek';
  showConfirm('Usunąć ten '+verb+'? Tej operacji nie można odwrócić.', ()=>{
    const p = type==='income' ? dataLayer.deleteIncome(id) : dataLayer.deleteExpense(id);
    p.then(()=>showToast('Usunięto')).catch(err=>{console.error(err);showToast('Nie udało się usunąć - sprawdź połączenie');});
  });
}

/* ============ RECURRING ============ */
function saveRecurring(){
  const d = state.recDraft;
  if(!d) return;
  const amount = parseAmountInput(document.getElementById('recAmount').value);
  if(!(amount>0)){ showToast('Wpisz kwotę'); return; }
  let day = parseInt(document.getElementById('recDay').value,10); if(isNaN(day)) day=1; day=Math.max(1,Math.min(28,day));
  const note = (document.getElementById('recNote')||{}).value || '';
  const payload = {
    type: d.type, amount, catId: d.catId,
    dayOfMonth: day, note: note.trim(), active:true, lastGenerated:null
  };
  if(d.type==='expense'){ payload.sub = d.sub || (CAT_BY_ID[d.catId]||{subs:['']}).subs[0]; }
  dataLayer.addRecurring(payload).then(()=>{ showToast('Dodano płatność cykliczną'); }).catch(err=>{console.error(err);showToast('Nie udało się dodać');});
  state.recDraft=null;
  render();
}

function confirmDeleteRecurring(id){
  showConfirm('Usunąć tę płatność cykliczną? Dotychczas utworzone wpisy zostają.', ()=>{
    dataLayer.deleteRecurring(id).then(()=>showToast('Usunięto')).catch(err=>{console.error(err);showToast('Nie udało się usunąć');});
  });
}

function maybeGenerateRecurring(){
  if(recurringDone) return;
  if(!recurringLoaded || !expensesLoaded || !incomeLoaded) return;
  recurringDone = true;
  generateRecurring();
}

function generateRecurring(){
  const cur = new Date(today.getFullYear(), today.getMonth(), 1);
  state.recurring.forEach(r=>{
    if(!r.active) return;
    let p;
    if(r.lastGenerated){
      const [ly,lm] = r.lastGenerated.split('-').map(Number);
      p = new Date(ly, lm-1+1, 1); // month after last generated
    } else {
      p = new Date(cur);
    }
    // cap backfill to 12 months
    const cap = new Date(cur); cap.setMonth(cap.getMonth()-11);
    if(p < cap) p = cap;

    let lastGen = r.lastGenerated;
    while(p <= cur){
      const isCurrent = p.getFullYear()===cur.getFullYear() && p.getMonth()===cur.getMonth();
      const dueReached = today.getDate() >= r.dayOfMonth;
      if(!isCurrent || dueReached){
        const day = Math.min(r.dayOfMonth, daysInMonth(p.getFullYear(), p.getMonth()));
        const dateStr = p.getFullYear()+'-'+pad2(p.getMonth()+1)+'-'+pad2(day);
        const period = p.getFullYear()+'-'+pad2(p.getMonth()+1);
        const bucket = r.type==='income' ? state.income : state.expenses;
        const exists = bucket.some(e=> e.recurringId===r.id && e.date && e.date.slice(0,7)===period);
        if(!exists){
          if(r.type==='income'){
            dataLayer.addIncome({amount:r.amount, srcId:r.catId, date:dateStr, note:r.note||'', createdAt:Date.now(), recurringId:r.id, auto:true});
          } else {
            dataLayer.addExpense({amount:r.amount, catId:r.catId, sub:r.sub||'', date:dateStr, note:r.note||'', createdAt:Date.now(), recurringId:r.id, auto:true});
          }
        }
        lastGen = period;
      }
      p.setMonth(p.getMonth()+1);
    }
    if(lastGen && lastGen!==r.lastGenerated){
      dataLayer.updateRecurring(r.id, {lastGenerated:lastGen});
    }
  });
}

/* ============ THEME ============ */
function setTheme(theme){
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  try{ localStorage.setItem('wydatki-theme', theme); }catch(e){}
  const meta = document.getElementById('themeColorMeta');
  if(meta) meta.setAttribute('content', theme==='light' ? '#EDE7D9' : '#15211C');
  render();
}

/* ============ EXPORT / IMPORT ============ */
function exportData(){
  const payload = {
    exportedAt: new Date().toISOString(),
    budget: state.budget,
    categoryBudgets: state.categoryBudgets,
    expenses: state.expenses,
    income: state.income
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'wydatki-eksport-'+ymd(today)+'.json';
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
      const incomingExp = Array.isArray(data) ? data : (data.expenses||[]);
      const incomingInc = Array.isArray(data) ? [] : (data.income||[]);
      const validExp = incomingExp.filter(e=> e && typeof e.amount==='number' && e.date && e.sub);
      const validInc = incomingInc.filter(e=> e && typeof e.amount==='number' && e.date && e.srcId);
      const totalN = validExp.length + validInc.length;
      if(totalN===0) throw new Error('Brak poprawnych wpisów');
      showToast('Importowanie '+totalN+' wpisów…');
      const ops = [];
      validExp.forEach(e=> ops.push(dataLayer.addExpense({
        amount:e.amount, catId: CAT_BY_ID[e.catId]?e.catId:'inne', sub:e.sub, date:e.date,
        note:e.note||'', createdAt:e.createdAt||Date.now(),
        split: (e.split&&e.split.enabled)?{enabled:true,share:e.split.share||0.5,payer:'me'}:{enabled:false}
      })));
      validInc.forEach(e=> ops.push(dataLayer.addIncome({
        amount:e.amount, srcId: INC_BY_ID[e.srcId]?e.srcId:'inne', date:e.date, note:e.note||'', createdAt:e.createdAt||Date.now()
      })));
      Promise.all(ops).then(()=>showToast('Zaimportowano '+totalN+' wpisów')).catch(err=>{console.error(err);showToast('Część wpisów nie została zaimportowana');});
    }catch(err){
      console.error(err);
      showToast('Nie udało się odczytać pliku - sprawdź, czy to poprawny eksport.');
    }
  };
  reader.readAsText(file);
  ev.target.value='';
}

/* ============ NAVIGATION ============ */
function shiftMonth(dir){
  let {y,m} = state.cursor;
  m += dir;
  if(m<0){ m=11; y--; } else if(m>11){ m=0; y++; }
  state.cursor = {y,m};
  ensureWindow();
  render();
}
function shiftSplit(dir){
  let {y,m} = state.splitCursor;
  m += dir;
  if(m<0){ m=11; y--; } else if(m>11){ m=0; y++; }
  state.splitCursor = {y,m};
  ensureWindow();
  render();
}

/* Grow the subscription window to cover any year the user navigates to. */
function ensureWindow(){
  let min = state.windowMinYear, max = state.windowMaxYear;
  [today.getFullYear(), state.cursor.y, state.yearCursor, state.splitCursor.y].forEach(yr=>{
    if(yr<min) min=yr;
    if(yr>max) max=yr;
  });
  if(min!==state.windowMinYear || max!==state.windowMaxYear){
    state.windowMinYear=min; state.windowMaxYear=max;
    subscribeData();
  }
}

function subscribeData(){
  const start = state.windowMinYear+'-01-01';
  const end = state.windowMaxYear+'-12-31';
  if(unsubExpenses) unsubExpenses();
  if(unsubIncome) unsubIncome();
  unsubExpenses = dataLayer.onExpensesRange(start, end, list=>{
    state.expenses = list; expensesLoaded=true; maybeGenerateRecurring(); render();
  });
  unsubIncome = dataLayer.onIncomeRange(start, end, list=>{
    state.income = list; incomeLoaded=true; maybeGenerateRecurring(); render();
  });
}

/* ============ INIT / TEARDOWN ============ */
function init(layer){
  dataLayer = layer;
  recurringLoaded=expensesLoaded=incomeLoaded=recurringDone=false;
  // apply persisted theme to <html> (in case index.html script missed it)
  document.documentElement.setAttribute('data-theme', state.theme);

  subscribeData();

  unsubRecurring = dataLayer.onRecurring(list=>{
    state.recurring = list; recurringLoaded=true; maybeGenerateRecurring(); render();
  });
  unsubSettings = dataLayer.onSettings(data=>{
    state.budget = (typeof data.budget==='number') ? data.budget : null;
    state.categoryBudgets = data.categoryBudgets || {};
    state.friendName = data.friendName || 'Znajomy';
    render();
  });
  unsubConn = dataLayer.onConnection(info=>{
    state.connection = info; render();
  });
  render();
}

function teardown(){
  if(unsubExpenses) unsubExpenses();
  if(unsubIncome) unsubIncome();
  if(unsubRecurring) unsubRecurring();
  if(unsubSettings) unsubSettings();
  if(unsubConn) unsubConn();
  unsubExpenses=unsubIncome=unsubRecurring=unsubSettings=unsubConn=null;
  state.expenses=[]; state.income=[]; state.recurring=[]; state.budget=null; state.categoryBudgets={};
  state.selCatId=null; state.selSub=null; state.editId=null; state.editType=null; state.view='add';
  state.addMode='expense'; state.splitOn=false; state.recDraft=null; state.filterCatId=null; state.searchQuery='';
  recurringLoaded=expensesLoaded=incomeLoaded=recurringDone=false;
}

return { init, teardown, _internal: { state, CATEGORIES, INCOME_CATS, fmtMoney, parseAmountInput, evalAmountExpr } };
})();
