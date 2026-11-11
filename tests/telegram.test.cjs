const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sendNotification,deliverOnce}=require('../functions/telegram');
const record={phone:'0900000000',amount:50000,time:'<test>',status:'PENDING'};
test('backend sends escaped HTML and checks API response',async()=>{
 let request;
 const id=await sendNotification(record,'order1','deposits','test','group',async(url,options)=>{
  request=JSON.parse(options.body);return {ok:true,json:async()=>({ok:true,result:{message_id:42}})};
 });
 assert.equal(id,42);assert.equal(request.chat_id,'group');assert.match(request.text,/&lt;test&gt;/);
 await assert.rejects(sendNotification(record,'id','deposits','test','group',async()=>({ok:true,json:async()=>({ok:false})})),/TELEGRAM_API_REJECTED/);
});
test('network error cannot leak a token through error messages',async()=>{
 await assert.rejects(sendNotification(record,'id','deposits','secret','group',async()=>{throw Error('https://api.telegram.org/botsecret/sendMessage');}),{message:'TELEGRAM_DELIVERY_UNCONFIRMED'});
});
test('invalid orders and missing configuration do not send',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;};
 await assert.rejects(sendNotification({...record,amount:-1},'id','deposits','test','group',fetchImpl),/INVALID_ORDER/);
 await assert.rejects(sendNotification(record,'id','deposits','','group',fetchImpl),/MISSING_TELEGRAM_CONFIG/);
 assert.equal(calls,0);
});
test('duplicate event does not send twice and success is recorded',async()=>{
 let state=null,calls=0;
 const stateRef={transaction:async fn=>{const next=fn(state);if(next===undefined)return {committed:false};state=next;return {committed:true};},set:async data=>{state=data;}};
 const opts={stateRef,record,orderId:'id',kind:'deposits',token:'test',chatId:'group',fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({ok:true,result:{message_id:42}})};}};
 await deliverOnce(opts);await deliverOnce(opts);assert.equal(calls,1);assert.equal(state.status,'SENT');
});
test('failed delivery is recorded without automatically resending ambiguous requests',async()=>{
 let state=null,calls=0;
 const stateRef={transaction:async fn=>{const next=fn(state);if(next===undefined)return {committed:false};state=next;return {committed:true};},set:async data=>{state=data;}};
 const opts={stateRef,record,orderId:'id',kind:'deposits',token:'test',chatId:'group',fetchImpl:async()=>{calls++;throw Error('network');}};
 await assert.rejects(deliverOnce(opts),/TELEGRAM_DELIVERY_UNCONFIRMED/);assert.equal(state.status,'FAILED');
 await deliverOnce(opts);assert.equal(calls,1);
});
