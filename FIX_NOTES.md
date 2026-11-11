# Sửa luồng nạp và thông báo Telegram

## Đã sửa

- Mã đơn dùng Firebase push để tránh trùng mã bốn chữ số.
- Ghi `pending_deposits` và lịch sử trong một lần cập nhật; chỉ hiện QR sau khi lưu thành công, chặn bấm kép và báo lỗi ghi Firebase.
- Khôi phục bảng admin, số lượng lệnh, danh sách thành viên, giftcode và nhật ký hủy; dùng textContent cho dữ liệu hiển thị, báo lỗi quyền đọc, dọn listener khi khóa/mở lại.
- Xóa token Telegram và các lệnh gọi Telegram trực tiếp khỏi hai trang HTML.
- Thêm Cloud Functions `notifyDeposit` và `notifyWithdraw`. Chỉ khi tạo bản ghi pending mới, backend mới gửi Telegram; backend đọc secret, kiểm tra HTTP/JSON, giới hạn thời gian chờ và ghi trạng thái vào `notification_delivery/{deposits|withdraws}/{orderId}`.
- Ghi nhận sự kiện trước khi gửi để hạn chế gửi trùng khi Firebase giao lại sự kiện. Bản ghi SENT/FAILED/SENDING không tự gửi lại. Nếu timeout hoặc backend bị ngắt giữa chừng, cần đối chiếu Telegram và nhật ký trước khi quyết định gửi thủ công.

## Bắt buộc trước khi sử dụng Telegram

**Đẩy GitHub chưa triển khai Firebase. Các thông báo Telegram sẽ chỉ hoạt động sau các bước dưới đây.**

1. Thu hồi token cũ qua BotFather vì nó đã nằm trong lịch sử repository công khai. Không đưa token mới vào GitHub hoặc chat.
2. Trên máy có Node.js 22 và Firebase CLI, đăng nhập tài khoản quản lý dự án:

```sh
firebase login
npm install --prefix functions
firebase functions:secrets:set TELEGRAM_BOT_TOKEN --project binance-pro-investment
firebase functions:secrets:set TELEGRAM_CHAT_ID --project binance-pro-investment
firebase deploy --only functions:notifications --project binance-pro-investment
```

CLI yêu cầu nhập secret riêng. Dùng token mới và ID nhóm đã thêm bot, cho phép bot gửi tin. Dự án cần đáp ứng yêu cầu triển khai Cloud Functions; kiểm tra billing/quyền IAM trước khi triển khai. Tên instance đã được đối chiếu với URL trong HTML; vùng functions là asia-southeast1.

Tham khảo chính thức:
- https://firebase.google.com/docs/functions/database-events
- https://firebase.google.com/docs/functions/config-env
- https://firebase.google.com/docs/functions/organize-functions

## Thiết lập đăng nhập admin

Trong Firebase Console, bật Authentication > Sign-in method > Email/Password, tạo một người dùng quản trị. Chủ dự án dùng Firebase Admin SDK để gọi `getAuth().setCustomUserClaims(uid, {admin: true})` với UID đó, từ máy/backend có quyền quản lý dự án. Không đưa khóa dịch vụ vào repository. Sau đó đăng nhập bằng email và mật khẩu riêng trên trang admin. Chỉ giao diện đăng nhập này không thay thế việc triển khai Database Rules phù hợp.

## Giới hạn

- Mã admin gốc còn thiếu bộ xử lý duyệt/từ chối tiền và nhiều thao tác quản trị. Bản này khôi phục hiển thị, không bổ sung nghiệp vụ đó; bảng ghi rõ đang chờ xử lý.
- Tạo QR là yêu cầu nạp, không xác nhận ngân hàng đã nhận tiền. Chưa có đối soát ngân hàng.
- Trang admin bỏ mật khẩu ghi cứng và nút tạo tài khoản mẫu. Đăng nhập mới dùng Firebase Authentication Email/Password và yêu cầu custom claim `admin: true`. Cần bật phương thức Email/Password, tạo tài khoản quản trị riêng, và dùng Firebase Admin SDK trong môi trường đáng tin cậy để cấp claim (không cấp từ trình duyệt). Chưa thay Firebase Rules: phải kiểm tra `auth.token.admin === true` cho các thao tác admin; không mở read/write công khai để tránh lỗi quyền. Đặc biệt phải chặn client ghi `notification_delivery` và sửa lệnh đã tạo.
- Chưa triển khai/kiểm thử trên Firebase thực tế; chưa gửi Telegram thật. Chưa cài dependencies/backend hoặc kiểm thử Firebase Emulator trong môi trường này.
- Các thông báo chỉ áp dụng đơn tạo mới sau khi deploy, không tự quét đơn cũ. Không có tự động retry sau lỗi để tránh gửi trùng khi Telegram đã nhận nhưng phản hồi bị mất.
- Lịch sử vẫn dùng mảng cũ, có thể bị ghi đè nếu nhiều phiên cùng tài khoản cùng cập nhật; cần migration riêng sang lịch sử theo ID.
- Kiểm thử trình duyệt bị chặn do Chromium không tạo được socket trong môi trường hiện tại.

## Kiểm tra

```sh
node --test tests/*.test.cjs
```

11 ca kiểm tra giả lập: lưu đơn nguyên tử, từ chối ghi, thiếu database/số tiền không hợp lệ, bấm kép, render và listener admin, kiểm tra admin claim, gửi Telegram backend, chống lộ token qua lỗi, dữ liệu không hợp lệ, sự kiện lặp và ghi nhận thất bại. Cả hai script HTML và backend qua kiểm tra cú pháp Node.
