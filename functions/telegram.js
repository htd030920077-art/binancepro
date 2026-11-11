'use strict';
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
async function sendNotification(record, orderId, kind, token, chatId, fetchImpl = fetch) {
  if (!token || !chatId) throw new Error('MISSING_TELEGRAM_CONFIG');
  if (!record || record.status !== 'PENDING' || !Number.isSafeInteger(record.amount) || record.amount <= 0 || !/^0\d{9}$/.test(String(record.phone))) {
    throw new Error('INVALID_ORDER');
  }
  const label = kind === 'deposits' ? 'LỆNH NẠP' : 'LỆNH RÚT';
  const text = `<b>${label} MỚI CHỜ DUYỆT</b>\nMã: <code>${escapeHtml(orderId)}</code>\nTài khoản: ${escapeHtml(record.phone)}\nSố tiền: ${record.amount.toLocaleString('vi-VN')} đ\nThời gian: ${escapeHtml(String(record.time || '').slice(0, 100))}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', signal: controller.signal,
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({chat_id:chatId, text, parse_mode:'HTML'})
    });
    const result = await response.json();
    // Do not include the request URL, token, or remote error description in logs.
    if (!response.ok || result.ok !== true) throw new Error('TELEGRAM_API_REJECTED');
    return result.result?.message_id || null;
  } catch (err) {
    if (err.message === 'TELEGRAM_API_REJECTED') throw err;
    throw new Error('TELEGRAM_DELIVERY_UNCONFIRMED');
  } finally { clearTimeout(timer); }
}
async function deliverOnce({stateRef, record, orderId, kind, token, chatId, fetchImpl}) {
  const claim = await stateRef.transaction(current => current === null ? {status:'SENDING', updatedAt:Date.now()} : undefined);
  if (!claim.committed) return false;
  try {
    const messageId = await sendNotification(record, orderId, kind, token, chatId, fetchImpl);
    await stateRef.set({status:'SENT', messageId, updatedAt:Date.now()});
    return true;
  } catch (err) {
    await stateRef.set({status:'FAILED', code:err.message, updatedAt:Date.now()});
    throw err;
  }
}
module.exports = {sendNotification, deliverOnce};
