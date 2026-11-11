const {test}=require('node:test');
const assert=require('node:assert/strict');
const {approveDeposit,resolveParents}=require('../functions/referrals');
const f2='0900000001',f1='0900000002',child='0900000003';
function fixture(){return {users:{[f2]:{balance:0},[f1]:{balance:0,inviterPhone:f2},[child]:{balance:20000,inviterPhone:f1,orders:[{id:'d1',status:'pending'}]}},pending_deposits:{d1:{phone:child,amount:50000,status:'PENDING'}}};}
test('approved deposit credits wallet, F1/F2 and one qualified friend together',()=>{
 const input=fixture();const root=approveDeposit(input,'d1','admin',1);
 assert.equal(input.users[child].balance,20000);
 assert.equal(root.users[child].balance,70000);assert.equal(root.users[child].totalDeposited,50000);
 assert.equal(root.users[f1].balance,6500);assert.equal(root.users[f1].f1CommissionTotal,6500);
 assert.equal(root.users[f2].balance,1000);assert.equal(root.users[f2].f2CommissionTotal,1000);
 assert.equal(root.users[f1].f1DepositedCount,1);assert.equal(root.pending_deposits.d1,undefined);
 assert.equal(root.users[child].orders[0].status,'approved');assert.equal(root.user_tx_status[child].deposits.d1.status,'APPROVED');
});
test('same order approved twice pays exactly once',()=>{
 const first=approveDeposit(fixture(),'d1','admin',1);const second=approveDeposit(first,'d1','other-admin',2);
 assert.deepEqual(second,first);
});
test('second deposit pays commission again but does not count friend twice',()=>{
 const root=approveDeposit(fixture(),'d1','admin',1);
 root.pending_deposits.d2={phone:child,amount:20000,status:'PENDING'};
 const next=approveDeposit(root,'d2','admin',2);
 assert.equal(next.users[f1].f1DepositedCount,1);assert.equal(next.users[f1].f1CommissionTotal,9100);
});
test('fifth unique friend earns milestone once; repeated deposit does not pay milestone again',()=>{
 const root=fixture();root.referral_qualified={[f1]:{a:{},b:{},c:{},d:{}}};
 const first=approveDeposit(root,'d1','admin',1);
 assert.equal(first.users[f1].balance,56500);assert.equal(first.users[f1].taskClaimed[5],true);
 assert.equal(first.referral_rewards[f1][5].amount,50000);
 first.pending_deposits.d2={phone:child,amount:20000,status:'PENDING'};
 const next=approveDeposit(first,'d2','admin',2);assert.equal(next.users[f1].balance,59100);
});
test('previously claimed legacy milestone is not credited again',()=>{
 const root=fixture();root.referral_qualified={[f1]:{a:{},b:{},c:{},d:{}}};root.users[f1].taskClaimed={5:true};
 const next=approveDeposit(root,'d1','admin',1);assert.equal(next.users[f1].balance,6500);assert.equal(next.referral_rewards[f1][5].legacyClaimed,true);
});
test('self-referral and cycles cannot receive commission',()=>{
 const root=fixture();root.users[child].inviterPhone=child;
 const next=approveDeposit(root,'d1','admin',1);assert.equal(next.users[f1].balance,0);assert.equal(next.deposit_approvals.d1.payouts.length,0);
 const cycle=fixture();cycle.users[f2].inviterPhone=child;assert.deepEqual(resolveParents(cycle,child),[]);
});
test('nonexistent inviter gets no commission and no progress',()=>{
 const root=fixture();root.users[child].inviterPhone='0999999999';
 const next=approveDeposit(root,'d1','admin',1);assert.equal(next.deposit_approvals.d1.payouts.length,0);
});
test('inviter relationship is locked after first approval',()=>{
 const root=approveDeposit(fixture(),'d1','admin',1);root.users[child].inviterPhone=f2;
 root.pending_deposits.d2={phone:child,amount:20000,status:'PENDING'};
 const next=approveDeposit(root,'d2','admin',2);assert.equal(next.users[f1].f1CommissionTotal,9100);assert.equal(next.users[child].inviterPhone,f1);
});
test('unapproved, invalid, and changed orders never mutate funds',()=>{
 const root=fixture();assert.throws(()=>approveDeposit(root,'missing','admin',1),/ORDER_NOT_PENDING/);
 root.pending_deposits.d1.status='REJECTED';assert.throws(()=>approveDeposit(root,'d1','admin',1),/ORDER_NOT_PENDING/);
 root.pending_deposits.d1.status='PENDING';root.pending_deposits.d1.amount=-100;
 assert.throws(()=>approveDeposit(root,'d1','admin',1),/INVALID_ORDER/);
 root.pending_deposits.d1.amount=50000;
 assert.throws(()=>approveDeposit(root,'d1','admin',1,{amount:100000,phone:child}),/ORDER_CHANGED/);
 assert.equal(root.users[child].balance,20000);
});
test('any invalid balance aborts all credits',()=>{
 const root=fixture();root.users[f1].balance='invalid';
 assert.throws(()=>approveDeposit(root,'d1','admin',1),/INVALID_BALANCE/);assert.equal(root.users[child].balance,20000);
});
