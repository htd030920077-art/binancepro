const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../functions/index.js'),'utf8');
function fixture(state){
 let writes=0;
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const exports={};
 const rootRef={transaction:async updater=>{
  writes++;updater(null);const next=updater(state);const committed=next!==undefined;if(committed)state=next;
  return {committed,snapshot:{child:()=>({child:id=>({val:()=>state.deposit_approvals?.[id]||null})})}};
 }};
 const modules={
  'firebase-functions/v2/database':{onValueCreated:()=>()=>{}},
  'firebase-functions/params':{defineSecret:()=>({value:()=>''})},
  'firebase-admin/app':{initializeApp(){}},
  'firebase-functions/v2/https':{onCall:(opts,handler)=>handler,HttpsError},
  'firebase-admin/database':{getDatabase:()=>({ref:()=>rootRef})},
  './telegram':{deliverOnce(){}},'./referrals':require('../functions/referrals')
 };
 vm.runInNewContext(source,{require:name=>modules[name],exports});
 return {call:exports.approveDeposit,writes:()=>writes,state:()=>state};
}
test('callable rejects anonymous and non-admin users before database access',async()=>{
 const f=fixture({});
 await assert.rejects(f.call({data:{orderId:'test'}}),{code:'permission-denied'});
 await assert.rejects(f.call({auth:{uid:'user',token:{}},data:{orderId:'test'}}),{code:'permission-denied'});
 assert.equal(f.writes(),0);
});
test('admin must confirm the exact amount and phone shown in the review dialog',async()=>{
 const phone='0900000000';const initial={users:{[phone]:{balance:0}},pending_deposits:{test:{phone,amount:50000,status:'PENDING'}}};
 const f=fixture(initial);const auth={uid:'admin',token:{admin:true}};
 await assert.rejects(f.call({auth,data:{orderId:'test',expectedAmount:100000,expectedPhone:phone}}),{code:'failed-precondition'});
 assert.equal(f.state().users[phone].balance,0);
 const result=await f.call({auth,data:{orderId:'test',expectedAmount:50000,expectedPhone:phone}});
 assert.equal(result.status,'APPROVED');assert.equal(f.state().users[phone].balance,50000);
 await f.call({auth,data:{orderId:'test',expectedAmount:50000,expectedPhone:phone}});
 assert.equal(f.state().users[phone].balance,50000);
});
