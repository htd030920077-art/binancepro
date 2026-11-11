'use strict';
const MILESTONES = {5:50000,10:100000,20:200000,50:500000,100:1000000};
const PHONE = /^0\d{9}$/;
function money(value) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('INVALID_BALANCE');
  return number;
}
function add(user, key, amount) {
  const result = money(user[key]) + amount;
  if (!Number.isSafeInteger(result)) throw new Error('BALANCE_OVERFLOW');
  user[key] = result;
}
function parentOf(root, phone) {
  const locked = root.referral_relationships?.[phone];
  return locked ? locked.f1 : String(root.users?.[phone]?.inviterPhone || root.users?.[phone]?.invite || '');
}
function resolveParents(root, phone) {
  const seen = new Set([phone]);
  const chain = [];
  let cursor = parentOf(root, phone);
  // Reject the whole chain if it is cyclic or unexpectedly deep.
  while (cursor) {
    if (!PHONE.test(cursor) || !root.users[cursor]) return chain.slice(0, 2);
    if (seen.has(cursor) || seen.size > 100) return [];
    seen.add(cursor);
    chain.push(cursor);
    cursor = parentOf(root, cursor);
  }
  return chain.slice(0, 2);
}
function approveDeposit(state, orderId, actorUid, now, expected) {
  if (!state) throw new Error('NO_DATA');
  if (state.deposit_approvals?.[orderId]) return state;
  const pending = state.pending_deposits?.[orderId];
  if (!pending || pending.status !== 'PENDING') throw new Error('ORDER_NOT_PENDING');
  if (!PHONE.test(String(pending.phone)) || !Number.isSafeInteger(pending.amount) || pending.amount < 20000 || pending.amount > 10000000) throw new Error('INVALID_ORDER');
  if (expected && (pending.amount !== expected.amount || pending.phone !== expected.phone)) throw new Error('ORDER_CHANGED');
  if (!state.users?.[pending.phone]) throw new Error('USER_NOT_FOUND');
  const root = structuredClone(state);
  const order = root.pending_deposits[orderId];
  const phone = order.phone;
  const user = root.users[phone];
  root.referral_relationships ||= {};
  if (!root.referral_relationships[phone]) {
    const parents = resolveParents(root, phone);
    root.referral_relationships[phone] = {f1:parents[0] || '',f2:parents[1] || '',lockedAt:now};
  }
  const relationship = root.referral_relationships[phone];
  user.inviterPhone = relationship.f1;
  user.invite = relationship.f1;
  const payouts = [];
  add(user, 'balance', order.amount);
  add(user, 'totalDeposited', order.amount);
  user.hasDeposited = true;
  const validRecipients = new Set([phone]);
  for (const [level, recipient, percent] of [['f1',relationship.f1,13],['f2',relationship.f2,2]]) {
    if (!recipient || validRecipients.has(recipient) || !root.users[recipient]) continue;
    validRecipients.add(recipient);
    const inviter = root.users[recipient];
    const commission = Math.floor(order.amount * percent / 100);
    add(inviter, 'balance', commission);
    add(inviter, level + 'CommissionTotal', commission);
    payouts.push({phone:recipient,level,amount:commission});
    if (level === 'f1') {
      root.referral_qualified ||= {};
      root.referral_qualified[recipient] ||= {};
      root.referral_qualified[recipient][phone] ||= {orderId,qualifiedAt:now};
      inviter.f1DepositedCount = Object.keys(root.referral_qualified[recipient]).length;
      root.referral_rewards ||= {};
      root.referral_rewards[recipient] ||= {};
      inviter.taskClaimed ||= {};
      for (const [count, amount] of Object.entries(MILESTONES)) {
        if (inviter.f1DepositedCount < Number(count) || root.referral_rewards[recipient][count]) continue;
        const legacyClaimed = inviter.taskClaimed[count] === true;
        if (!legacyClaimed) add(inviter, 'balance', amount);
        inviter.taskClaimed[count] = true;
        root.referral_rewards[recipient][count] = {amount:legacyClaimed ? 0 : amount,legacyClaimed,orderId,paidAt:now};
      }
    }
  }
  // Preserve array/object history and change only this order's status.
  const historyKey = Object.keys(user.orders || {}).find(key => user.orders[key]?.id === orderId);
  if (historyKey !== undefined) user.orders[historyKey].status = 'approved';
  root.user_tx_status ||= {};
  root.user_tx_status[phone] ||= {};
  root.user_tx_status[phone].deposits ||= {};
  root.user_tx_status[phone].deposits[orderId] = {status:'APPROVED',amount:order.amount,approvedAt:now};
  root.deposit_approvals ||= {};
  root.deposit_approvals[orderId] = {orderId,phone,amount:order.amount,approvedAt:now,actorUid,payouts};
  delete root.pending_deposits[orderId];
  return root;
}
module.exports = {approveDeposit,resolveParents,MILESTONES};
