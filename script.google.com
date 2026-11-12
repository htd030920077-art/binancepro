const FIREBASE_DB_URL = 'https://binance-pro-investment-default-rtdb.asia-southeast1.firebasedatabase.app';
const BOT_TOKEN = '9026086925:AAFfbu1oOyasRCTJJXYzOj-2qanQhhnozsk';
const CHAT_ID = '7865394196';

function doGet(e) {
  return ContentService.createTextOutput('CoinChaine SePay Webhook is Active!');
}

function doPost(e) {
  try {
    const raw = e.postData ? e.postData.contents : '{}';
    const data = JSON.parse(raw);

    if (data.transferType !== 'in') {
      return jsonResponse({ success: true, msg: 'Bỏ qua giao dịch tiền ra' });
    }

    const amount = Number(data.transferAmount || 0);
    const content = String(data.content || '').toUpperCase();
    const sepayTxId = String(data.id || Date.now());

    // Tìm số điện thoại sau chữ NT (VD: "NT 0984568899" hoặc "NT0984568899")
    const match = content.match(/NT\s*(\d{9,15})/);
    if (!match || amount < 10000) {
      return jsonResponse({ success: true, msg: 'Không khớp cú pháp NT <SĐT>' });
    }

    const phone = match[1];

    // 1. Chống cộng trùng giao dịch SePay
    const dupRes = UrlFetchApp.fetch(`${FIREBASE_DB_URL}/sepay_processed/${sepayTxId}.json`);
    if (JSON.parse(dupRes.getContentText())) {
      return jsonResponse({ success: true, msg: 'Giao dịch đã xử lý' });
    }

    // 2. Lấy dữ liệu User trên Firebase
    const userUrl = `${FIREBASE_DB_URL}/users/${phone}.json`;
    const user = JSON.parse(UrlFetchApp.fetch(userUrl).getContentText());
    if (!user) {
      return jsonResponse({ success: false, msg: 'Không tìm thấy SĐT' });
    }

    // 3. Lưu dấu đã xử lý
    fbRequest(`${FIREBASE_DB_URL}/sepay_processed/${sepayTxId}.json`, 'PUT', {
      phone: phone,
      amount: amount,
      time: new Date().toISOString()
    });

    // 4. Cộng số dư & cập nhật tổng nạp cho User
    const newBalance = Number(user.balance || 0) + amount;
    const newTotalDep = Number(user.totalDeposited || 0) + amount;
    const isFirstDeposit = !(Number(user.totalDeposited || 0) > 0 || user.hasDeposited);

    fbRequest(userUrl, 'PATCH', {
      balance: newBalance,
      totalDeposited: newTotalDep,
      hasDeposited: true
    });

    // 5. Cộng hoa hồng F1 (13%) & F2 (2%)
    const f1Phone = user.invite || user.inviterPhone;
    if (f1Phone && f1Phone !== phone) {
      const f1Url = `${FIREBASE_DB_URL}/users/${f1Phone}.json`;
      const f1 = JSON.parse(UrlFetchApp.fetch(f1Url).getContentText());
      if (f1) {
        const c1 = Math.round(amount * 0.13);
        const f1Update = {
          balance: Number(f1.balance || 0) + c1,
          f1CommissionTotal: Number(f1.f1CommissionTotal || 0) + c1
        };
        if (isFirstDeposit) {
          f1Update.f1DepositedCount = Number(f1.f1DepositedCount || 0) + 1;
        }
        fbRequest(f1Url, 'PATCH', f1Update);

        const f2Phone = f1.invite || f1.inviterPhone;
        if (f2Phone && f2Phone !== phone && f2Phone !== f1Phone) {
          const f2Url = `${FIREBASE_DB_URL}/users/${f2Phone}.json`;
          const f2 = JSON.parse(UrlFetchApp.fetch(f2Url).getContentText());
          if (f2) {
            const c2 = Math.round(amount * 0.02);
            fbRequest(f2Url, 'PATCH', {
              balance: Number(f2.balance || 0) + c2,
              f2CommissionTotal: Number(f2.f2CommissionTotal || 0) + c2
            });
          }
        }
      }
    }

    // 6. Xóa đơn chờ duyệt tương ứng (nếu có)
    const pendingRaw = UrlFetchApp.fetch(`${FIREBASE_DB_URL}/pending_deposits.json`).getContentText();
    const pending = JSON.parse(pendingRaw);
    if (pending) {
      for (const orderId in pending) {
        if (pending[orderId].phone === phone && Number(pending[orderId].amount) === amount) {
          fbRequest(`${FIREBASE_DB_URL}/pending_deposits/${orderId}.json`, 'DELETE');
          break;
        }
      }
    }

    // 7. Báo về Telegram Admin
    const msg = `✅ <b>SEPAY AUTO NẠP THÀNH CÔNG</b>\n━━━━━━━━━━━━━━━━━━━━\n▫️ SĐT: <b>${phone}</b>\n▫️ Số tiền: <b>+${amount.toLocaleString('vi-VN')} đ</b>\n▫️ Số dư mới: <b>${newBalance.toLocaleString('vi-VN')} đ</b>\n▫️ Mã GD SePay: <code>${sepayTxId}</code>`;
    UrlFetchApp.fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage?chat_id=${CHAT_ID}&text=${encodeURIComponent(msg)}&parse_mode=HTML`);

    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function fbRequest(url, method, payload) {
  const options = {
    method: method,
    contentType: 'application/json',
    muteHttpExceptions: true
  };
  if (payload) options.payload = JSON.stringify(payload);
  return UrlFetchApp.fetch(url, options);
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
