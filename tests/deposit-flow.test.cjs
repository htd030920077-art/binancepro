const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const player = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'quan-tri-bi-mat-x9872.html'), 'utf8');
function section(source, start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); }
function fixture(options = {}) {
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) elements.set(id, {value: id === 'depositAmountInput' ? '50000' : '', textContent: '',
      children: [], style: {}, disabled: false, classList: {add(){}, remove(){}},
      appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; }});
    return elements.get(id);
  };
  const state = { writes: [], toasts: [], modals: [], telegram: [], subscriptions: [], removed: [] };
  const db = {ref(p) {return {push: () => ({key: 'unique-order-1'}), update: async data => {
    state.writes.push(data); if (options.write) await options.write();
  }, on: (event, callback, onError) => state.subscriptions.push({p, callback, onError}),
  off: (event, callback) => state.removed.push({p, callback})};}};
  const context = vm.createContext({
    console: {error(){}, warn(){}}, setTimeout, clearTimeout, AbortController, URLSearchParams, Intl,
    db: options.noDb ? null : db, currentUser: {phone: '0900000000', orders: []},
    document: {getElementById: el, querySelector: () => el('submit'), createElement: () => ({children:[], appendChild(x){this.children.push(x);}})},
    showCustomToast: x => state.toasts.push(x), openAuthModal(){},
    closeModal(){}, openModal: x => state.modals.push(x), updateUI(){}, formatNumber: String,
    sendTelegramNotification: async text => { state.telegram.push(text); },
    adminBankConfig: {bank:'ACB',stk:'123',name:'Test'}, localStorage: {getItem(){return null;},setItem(){}},
    sessionStorage: {removeItem(){}}, fetch: options.fetch, TELEGRAM_CONFIG: {botToken:'test',chatId:'test'}
  });
  return {state, context, el};
}
const depositCode = section(player, '    let depositSubmitting = false;', '    function handleWithdrawClick()');
test('save pending deposit and history atomically before showing QR', async () => {
  const {context,state} = fixture(); vm.runInContext(depositCode, context);
  await context.submitDepositAction();
  assert.equal(state.writes.length, 1);
  assert.deepEqual(Object.keys(state.writes[0]), ['pending_deposits/unique-order-1','users/0900000000/orders']);
  assert.equal(state.writes[0]['pending_deposits/unique-order-1'].status, 'PENDING');
  assert.deepEqual(state.modals, ['vietqrModal']); assert.equal(state.telegram.length, 0);
});
test('denied write leaves local history intact and sends no notification or QR', async () => {
  const {context,state,el} = fixture({write: async () => {throw Object.assign(new Error('denied'),{code:'PERMISSION_DENIED'});}});
  vm.runInContext(depositCode,context); await context.submitDepositAction();
  assert.equal(context.currentUser.orders.length,0); assert.equal(state.telegram.length,0);
  assert.equal(state.modals.length,0); assert.match(state.toasts[0], /PERMISSION_DENIED/); assert.equal(el('submit').disabled,false);
});
test('disconnected database and invalid amount cannot create a deposit', async () => {
  const f = fixture({noDb:true}); vm.runInContext(depositCode,f.context); await f.context.submitDepositAction();
  assert.equal(f.state.writes.length,0); assert.equal(f.state.modals.length,0);
  const g = fixture(); g.el('depositAmountInput').value='20000.5';
  vm.runInContext(depositCode,g.context); await g.context.submitDepositAction(); assert.equal(g.state.writes.length,0);
});
test('double click during commit creates only one order', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const f = fixture({write: () => pending}); vm.runInContext(depositCode,f.context);
  const first = f.context.submitDepositAction(); await f.context.submitDepositAction();
  assert.equal(f.state.writes.length,1); release(); await first;
});
test('admin callbacks render pending rows; lock/reopen removes exact listeners', () => {
  const f = fixture(); const code = section(admin,'    const Admin = {','    auth.onAuthStateChanged');
  vm.runInContext(code+'\nglobalThis.adminUnderTest = Admin;',f.context);
  const a=f.context.adminUnderTest; a.listenRealtimeData();
  f.state.subscriptions.find(x=>x.p==='pending_deposits').callback({val:()=>({one:{phone:'0900000000',amount:50000,status:'PENDING',time:'now'},two:{status:'APPROVED'}})});
  assert.equal(f.el('badgeDep').textContent,'1'); assert.equal(f.el('tbodyDeposits').children.length,1);
  assert.equal(f.el('tbodyDeposits').children[0].children[1].textContent,'0900000000');
  for(const p of ['users','giftcodes','cancelled_logs']) f.state.subscriptions.find(x=>x.p===p).callback({val:()=>({})});
  f.state.subscriptions.find(x=>x.p==='pending_deposits').onError({code:'PERMISSION_DENIED'});
  assert.match(f.state.toasts.at(-1) || f.el('adminToast').textContent, /PERMISSION_DENIED/);
  a.listenRealtimeData(); assert.equal(f.state.removed.length,7);
});
test('admin opens only after a verified admin claim', async () => {
  const f=fixture();let callback,started=0,signedOut=0;
  f.context.auth={onAuthStateChanged:fn=>{callback=fn;},currentUser:null,signOut:async()=>{signedOut++;}};
  const code=section(admin,'    const Admin = {','    auth.onAuthStateChanged');
  vm.runInContext(code+'\nAdmin.listenRealtimeData=()=>{ globalThis.didStart=true; };',f.context);
  vm.runInContext(section(admin,'    auth.onAuthStateChanged','  </script>'),f.context);
  const regular={getIdTokenResult:async()=>({claims:{}})};f.context.auth.currentUser=regular;
  await callback(regular);assert.equal(f.context.didStart,undefined);assert.equal(signedOut,1);
  const privileged={getIdTokenResult:async()=>({claims:{admin:true}})};f.context.auth.currentUser=privileged;
  await callback(privileged);assert.equal(f.context.didStart,true);
});
