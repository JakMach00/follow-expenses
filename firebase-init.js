/* =====================================================================
   Firebase glue layer. Builds the `dataLayer` AppCore needs and wires up
   the auth screen. This is the ONLY part of the app that knows about
   Firebase - everything else talks through the dataLayer contract.
   ===================================================================== */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, setDoc, getDoc,
  query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBP-bJYoK2py4UgqUaabuf04NqOAOaQb0M",
  authDomain: "follow-expenses.firebaseapp.com",
  projectId: "follow-expenses",
  storageBucket: "follow-expenses.firebasestorage.app",
  messagingSenderId: "49363988299",
  appId: "1:49363988299:web:b70d3062774cd2d6a9c2ce"
};

const authScreen = document.getElementById('authScreen');
const loadingScreen = document.getElementById('loadingScreen');
const appRoot = document.getElementById('appRoot');

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

let currentUid = null;

function buildDataLayer(uid){
  const expensesCol = collection(db, 'users', uid, 'expenses');
  const incomeCol   = collection(db, 'users', uid, 'income');
  const recurringCol= collection(db, 'users', uid, 'recurring');
  const settingsDoc = doc(db, 'users', uid, 'meta', 'settings');

  return {
    /* ---- Expenses (date-range scoped) ---- */
    onExpensesRange(startYmd, endYmd, cb){
      // date is stored as 'YYYY-MM-DD' so lexicographic range == chronological range.
      const q = query(expensesCol, where('date', '>=', startYmd), where('date', '<=', endYmd));
      return onSnapshot(q, snap=>{
        const list = [];
        snap.forEach(d=> list.push(Object.assign({id:d.id}, d.data())));
        cb(list);
      }, err=> console.error('onExpensesRange error', err));
    },
    addExpense(data){ return addDoc(expensesCol, data); },
    updateExpense(id, data){ return updateDoc(doc(expensesCol, id), data); },
    deleteExpense(id){ return deleteDoc(doc(expensesCol, id)); },

    /* ---- Income (date-range scoped) ---- */
    onIncomeRange(startYmd, endYmd, cb){
      const q = query(incomeCol, where('date', '>=', startYmd), where('date', '<=', endYmd));
      return onSnapshot(q, snap=>{
        const list = [];
        snap.forEach(d=> list.push(Object.assign({id:d.id}, d.data())));
        cb(list);
      }, err=> console.error('onIncomeRange error', err));
    },
    addIncome(data){ return addDoc(incomeCol, data); },
    updateIncome(id, data){ return updateDoc(doc(incomeCol, id), data); },
    deleteIncome(id){ return deleteDoc(doc(incomeCol, id)); },

    /* ---- Recurring templates (small set, load all) ---- */
    onRecurring(cb){
      return onSnapshot(recurringCol, snap=>{
        const list = [];
        snap.forEach(d=> list.push(Object.assign({id:d.id}, d.data())));
        cb(list);
      }, err=> console.error('onRecurring error', err));
    },
    addRecurring(data){ return addDoc(recurringCol, data); },
    updateRecurring(id, data){ return updateDoc(doc(recurringCol, id), data); },
    deleteRecurring(id){ return deleteDoc(doc(recurringCol, id)); },

    /* ---- Settings (budget, per-category budgets, theme-independent prefs) ---- */
    onSettings(cb){
      return onSnapshot(settingsDoc, snap=>{
        cb(snap.exists() ? snap.data() : {});
      }, err=> console.error('onSettings error', err));
    },
    setSettings(partial){
      return setDoc(settingsDoc, partial, {merge:true});
    },

    /* ---- Connection state ---- */
    onConnection(cb){
      let online = navigator.onLine;
      let pendingWrites = false;
      function emit(){ cb({online, pendingWrites}); }
      const onOnline = ()=>{ online=true; emit(); };
      const onOffline = ()=>{ online=false; emit(); };
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
      const unsubSnap = onSnapshot(expensesCol, {includeMetadataChanges:true}, snap=>{
        pendingWrites = snap.metadata.hasPendingWrites;
        emit();
      }, ()=>{});
      emit();
      return ()=>{ window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); unsubSnap(); };
    },

    signOut(){
      return signOut(auth);
    }
  };
}

function showAuthScreen(){
  loadingScreen.style.display = 'none';
  appRoot.style.display = 'none';
  authScreen.style.display = 'flex';
}
function showApp(uid){
  authScreen.style.display = 'none';
  loadingScreen.style.display = 'none';
  appRoot.style.display = 'block';
  window.AppCore.init(buildDataLayer(uid));
}

onAuthStateChanged(auth, user=>{
  if(user){
    currentUid = user.uid;
    showApp(user.uid);
  } else {
    currentUid = null;
    window.AppCore.teardown();
    showAuthScreen();
  }
});

// ---- Auth screen wiring ----
let authMode = 'signin';
const tabIn = document.getElementById('authTabSignIn');
const tabUp = document.getElementById('authTabSignUp');
const emailEl = document.getElementById('authEmail');
const pwEl = document.getElementById('authPassword');
const errEl = document.getElementById('authError');
const submitBtn = document.getElementById('authSubmitBtn');
const forgotBtn = document.getElementById('authForgotBtn');

function setMode(mode){
  authMode = mode;
  tabIn.classList.toggle('active', mode==='signin');
  tabUp.classList.toggle('active', mode==='signup');
  submitBtn.textContent = mode==='signin' ? 'Zaloguj się' : 'Utwórz konto';
  errEl.classList.remove('show');
}
tabIn.addEventListener('click', ()=>setMode('signin'));
tabUp.addEventListener('click', ()=>setMode('signup'));

function authErrorMessage(code){
  const map = {
    'auth/invalid-email':'Nieprawidłowy adres e-mail.',
    'auth/missing-password':'Wpisz hasło.',
    'auth/weak-password':'Hasło musi mieć przynajmniej 6 znaków.',
    'auth/email-already-in-use':'To konto już istnieje - zaloguj się.',
    'auth/invalid-credential':'Nieprawidłowy e-mail lub hasło.',
    'auth/wrong-password':'Nieprawidłowy e-mail lub hasło.',
    'auth/user-not-found':'Nie znaleziono konta z tym adresem e-mail.',
    'auth/too-many-requests':'Zbyt wiele nieudanych prób - spróbuj za chwilę.',
    'auth/network-request-failed':'Brak połączenia z internetem. Logowanie wymaga sieci przy pierwszym razie na danym urządzeniu.'
  };
  return map[code] || ('Coś nie zadziałało (' + code + ').');
}

function attemptAuthSubmit(){
  const email = emailEl.value.trim();
  const pw = pwEl.value;
  errEl.classList.remove('show');
  if(!email || !pw){ errEl.textContent='Wpisz e-mail i hasło.'; errEl.classList.add('show'); return; }
  submitBtn.disabled = true;
  const action = authMode==='signin'
    ? signInWithEmailAndPassword(auth, email, pw)
    : createUserWithEmailAndPassword(auth, email, pw);
  action.catch(err=>{
    errEl.textContent = authErrorMessage(err.code);
    errEl.classList.add('show');
  }).finally(()=>{ submitBtn.disabled = false; });
}
submitBtn.addEventListener('click', attemptAuthSubmit);
emailEl.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); attemptAuthSubmit(); } });
pwEl.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); attemptAuthSubmit(); } });

forgotBtn.addEventListener('click', ()=>{
  const email = emailEl.value.trim();
  if(!email){ errEl.textContent='Wpisz najpierw swój e-mail powyżej.'; errEl.classList.add('show'); return; }
  sendPasswordResetEmail(auth, email).then(()=>{
    errEl.classList.remove('show');
    const toast = document.getElementById('toast');
    toast.textContent = 'Wysłano e-mail z linkiem do resetu hasła';
    toast.classList.add('show');
    setTimeout(()=>toast.classList.remove('show'), 3000);
  }).catch(err=>{
    errEl.textContent = authErrorMessage(err.code);
    errEl.classList.add('show');
  });
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(()=>{ /* offline-first still works without SW, just less robust on first load */ });
}
