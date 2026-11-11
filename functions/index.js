'use strict';
const {onValueCreated} = require('firebase-functions/v2/database');
const {defineSecret} = require('firebase-functions/params');
const {initializeApp} = require('firebase-admin/app');
const {deliverOnce} = require('./telegram');
initializeApp();
const botToken = defineSecret('TELEGRAM_BOT_TOKEN');
const chatId = defineSecret('TELEGRAM_CHAT_ID');
function notificationTrigger(kind) {
  return onValueCreated({
    ref: `/pending_${kind}/{orderId}`,
    instance: 'binance-pro-investment-default-rtdb',
    region: 'asia-southeast1',
    secrets: [botToken, chatId],
    retry: false,
    timeoutSeconds: 30,
    maxInstances: 3
  }, async event => {
    const orderId = event.params.orderId;
    await deliverOnce({
      stateRef: event.data.ref.root.child(`notification_delivery/${kind}/${orderId}`),
      record: event.data.val(), orderId, kind,
      token: botToken.value(), chatId: chatId.value()
    });
  });
}
exports.notifyDeposit = notificationTrigger('deposits');
exports.notifyWithdraw = notificationTrigger('withdraws');

// Only authenticated administrators can confirm a real, reconciled deposit.
const {onCall, HttpsError} = require('firebase-functions/v2/https');
const {getDatabase} = require('firebase-admin/database');
const {approveDeposit} = require('./referrals');
exports.approveDeposit = onCall({region:'asia-southeast1',timeoutSeconds:60,maxInstances:3}, async request => {
  if (request.auth?.token?.admin !== true) throw new HttpsError('permission-denied','Yêu cầu tài khoản quản trị.');
  const orderId = request.data?.orderId;
  if (typeof orderId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(orderId) || ['__proto__','constructor','prototype'].includes(orderId)) throw new HttpsError('invalid-argument','Mã lệnh không hợp lệ.');
  const expected = {amount:request.data?.expectedAmount,phone:request.data?.expectedPhone};
  if (!Number.isSafeInteger(expected.amount) || typeof expected.phone !== 'string') throw new HttpsError('invalid-argument','Cần xác nhận số tiền và người nạp.');
  const rootRef = getDatabase(undefined,'https://binance-pro-investment-default-rtdb.asia-southeast1.firebasedatabase.app').ref();
  const now = Date.now();
  let reason = '';
  const result = await rootRef.transaction(current => {
    // An uncached first invocation can be null; let Firebase retry against server data.
    if (current === null) return null;
    try { return approveDeposit(current,orderId,request.auth.uid,now,expected); }
    catch (error) { reason = error.message; return undefined; }
  });
  const receipt = result.snapshot?.child('deposit_approvals').child(orderId).val();
  if (!result.committed || !receipt) throw new HttpsError('failed-precondition',reason || 'Không thể duyệt lệnh nạp.');
  return {orderId,phone:receipt.phone,amount:receipt.amount,status:'APPROVED'};
});
