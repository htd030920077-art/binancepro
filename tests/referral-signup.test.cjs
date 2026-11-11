const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const formCode=source.slice(source.indexOf('    function submitAuthForm()'),source.indexOf('    function handleLogout()'));
function setup(refCode,{inviterExists=true,race=false}={}){
 const inputs={authPhoneInput:{value:'0900000003'},authPassInput:{value:'fixture-password'},authCaptchaInput:{value:'1234'},authConfirmPassInput:{value:'fixture-password'},authAgreementCheck:{checked:true},authRefInput:{value:refCode}};
 const tasks=[],messages=[],writes=[];let stored;
 const context=vm.createContext({authMode:'register',currentCaptcha:'1234',currentUser:null,document:{getElementById:id=>inputs[id]},showCustomToast:s=>messages.push(s),generateCaptchaCode(){},switchAuthTab(){},closeModal(){},triggerCongrat(){},listenUserRealtime(){},updateUI(){},localStorage:{setItem(){},removeItem(){}},db:{ref:p=>({once:(event,callback)=>{
   const snapshot={exists:()=>p==='users/0900000003'?false:inviterExists,val:()=>null};
   if(callback)tasks.push(Promise.resolve(callback(snapshot)));return Promise.resolve(snapshot);
 },transaction:async updater=>{const value=updater(race?{phone:'0900000003'}:null);if(value===undefined)return {committed:false};writes.push(value);stored=value;return {committed:true};}})}});
 vm.runInContext(formCode,context);
 return {context,messages,writes,stored:()=>stored,flush:async()=>{await Promise.all(tasks);await Promise.resolve();}};
}
test('registration saves valid inviter in both compatibility fields',async()=>{const f=setup('0900000002');f.context.submitAuthForm();await f.flush();assert.equal(f.stored().inviterPhone,'0900000002');assert.equal(f.stored().invite,'0900000002');});
test('registration rejects self-invite, malformed and nonexistent inviter',async()=>{for(const [ref,options]of [['0900000003',{}],['VIP8899',{}],['0900000002',{inviterExists:false}]]){const f=setup(ref,options);f.context.submitAuthForm();await f.flush();assert.equal(f.writes.length,0);assert.ok(f.messages.length);}});
test('registration transaction cannot overwrite a racing account creation',async()=>{const f=setup('',{race:true});f.context.submitAuthForm();await f.flush();assert.equal(f.writes.length,0);assert.match(f.messages.at(-1),/đã có tài khoản/);});
test('copy link uses requested domain and clipboard failure gives a manual fallback',async()=>{
 const start=source.indexOf('    async function copyRefLink()');const end=source.indexOf('    // ==================== NẠP & RÚT',start);const code=source.slice(start,end);
 let copied,selected=false;const messages=[];const input={value:'',focus(){},select(){selected=true;}};
 const context=vm.createContext({currentUser:{phone:'0900000002'},document:{getElementById:()=>input},navigator:{clipboard:{writeText:async value=>{copied=value;}}},showCustomToast:s=>messages.push(s)});
 vm.runInContext(code,context);await context.copyRefLink();assert.equal(copied,'https://binancepro.cloud/?ref=0900000002');
 context.navigator.clipboard.writeText=async()=>{throw Error('blocked');};await context.copyRefLink();assert.equal(selected,true);assert.match(messages.at(-1),/Chạm giữ/);
});
