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
