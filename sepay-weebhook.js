const FIREBASE_DB_URL = 'https://binance-pro-investment-default-rtdb.asia-southeast1.firebasedatabase.app';
const BOT_TOKEN = '9026086925:AAFfbu1oOyasRCTJJXYzOj-2qanQhhnozsk';
const CHAT_ID = '7865394196';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 200, body: 'CoinChaine SePay Webhook Ready' };
  }

  try {
    const data = JSON.parse(event.body || '{}');
    if (data.transferType !== 'in') {
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    const amount = Number(data.transferAmount || 0);
    const content = String(data.content || '').toUpperCase();
    const sepayTxId = String(data.id || Date.now());

    // Tìm số điện thoại sau chữ NT (VD: NT 0984568899)
    const match = content.match(/NT\s*(\d{9,15})/);
    if (!match || amount < 10000) {
      return { statusCode: 200, body: JSON.stringify({ success: true, msg: 'Bỏ qua nội dung không khớp' }) };
    }

    const phone = match[1];

    // 1. Chống cộng trùng giao dịch
    const dupRes = await fetch(`${FIREBASE_DB_URL}/sepay_processed/${sepayTxId}.json`);
    if (await dupRes.json()) {
      return { statusCode: 200, body: JSON.stringify({ success: true, msg: 'Đã xử lý' }) };
    }

    // 2. Lấy dữ liệu User
    const userUrl = `${FIREBASE_DB_URL}/users/${phone}.json`;
    const user = await (await fetch(userUrl)).json();
    if (!user) {
      return { statusCode: 200, body: JSON.stringify({ success: false, msg: 'Không thấy user' }) };
    }

    // 3. Lưu dấu đã xử lý
    await fetch(`${FIREBASE_DB_URL}/sepay_processed/${sepayTxId}.json`, {
      method: 'PUT',
      body: JSON.stringify({ phone, amount, time: new Date().toISOString() })
    });

    // 4. Cộng tiền & cập nhật tổng nạp
    const newBalance = Number(user.balance || 0) + amount;
    const newTotalDep = Number(user.totalDeposited || 0) + amount;
    const isFirstDeposit = !(Number(user.totalDeposited || 0) > 0 || user.hasDeposited);

    await fetch(userUrl, {
      method: 'PATCH',
      body: JSON.stringify({ balance: newBalance, totalDeposited: newTotalDep, hasDeposited: true })
    });

    // 5. Cộng hoa hồng F1 (13%) & F2 (2%)
    const f1Phone = user.invite || user.inviterPhone;
    if (f1Phone && f1Phone !== phone) {
      const f1Url = `${FIREBASE_DB_URL}/users/${f1Phone}.json`;
      const f1 = await (await fetch(f1Url)).json();
      if (f1) {
        const c1 = Math.round(amount * 0.13);
        await fetch(f1Url, {
          method: 'PATCH',
          body: JSON.stringify({
            balance: Number(f1.balance || 0) + c1,
            f1CommissionTotal: Number(f1.f1CommissionTotal || 0) + c1,
            ...(isFirstDeposit ? { f1DepositedCount: Number(f1.f1DepositedCount || 0) + 1 } : {})
          })
        });

        const f2Phone = f1.invite || f1.inviterPhone;
        if (f2Phone && f2Phone !== phone && f2Phone !== f1Phone) {
          const f2Url = `${FIREBASE_DB_URL}/users/${f2Phone}.json`;
          const f2 = await (await fetch(f2Url)).json();
          if (f2) {
            const c2 = Math.round(amount * 0.02);
            await fetch(f2Url, {
              method: 'PATCH',
              body: JSON.stringify({
                balance: Number(f2.balance || 0) + c2,
                f2CommissionTotal: Number(f2.f2CommissionTotal || 0) + c2
              })
            });
          }
        }
      }
    }

    // 6. Xóa đơn chờ tương ứng & báo Telegram
    const pending = await (await fetch(`${FIREBASE_DB_URL}/pending_deposits.json`)).json();
    if (pending) {
      for (const [orderId, order] of Object.entries(pending)) {
        if (order.phone === phone && Number(order.amount) === amount) {
          await fetch(`${FIREBASE_DB_URL}/pending_deposits/${orderId}.json`, { method: 'DELETE' });
          break;
        }
      }
    }

    const msg = `✅ <b>SEPAY AUTO NẠP THÀNH CÔNG</b>\n━━━━━━━━━━━━━━━━━━━━\n▫️ SĐT: <b>${phone}</b>\n▫️ Số tiền: <b>+${amount.toLocaleString('vi-VN')} đ</b>\n▫️ Số dư mới: <b>${newBalance.toLocaleString('vi-VN')} đ</b>\n▫️ Mã GD SePay: <code>${sepayTxId}</code>`;
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage?chat_id=${CHAT_ID}&text=${encodeURIComponent(msg)}&parse_mode=HTML`);

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
