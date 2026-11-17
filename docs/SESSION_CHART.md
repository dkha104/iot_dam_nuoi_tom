# Biểu đồ xem riêng từng đợt đo

Trang Tổng quan mặc định chỉ vẽ đợt đo gần nhất của chỉ số đang chọn. Danh sách Đợt đo và các nút trước/sau cho phép mở riêng các đợt cũ. Nút Đợt mới nhất đưa biểu đồ về chế độ theo dõi dữ liệu mới. Lịch sử dữ liệu vẫn giữ bộ lọc khoảng giờ/ngày như trước.

## Quy tắc tách đợt

- Một bản ghi cách bản ghi trước **hơn 5 phút** thì bắt đầu đợt mới. Đúng 5 phút vẫn cùng một đợt.
- Dùng `observedAt` gốc, không dùng thời điểm web gọi API. Tách theo dữ liệu của từng chỉ số, gồm cả các bản ghi có value null để không nhầm thiếu hiệu chuẩn với tắt thiết bị.
- Chạy liên tục qua 0 giờ vẫn là cùng một đợt. Dữ liệu hôm qua vẫn được lưu, nhưng không gộp các đợt gián đoạn vào biểu đồ đợt mới nhất.
- Đây là suy luận từ khoảng gián đoạn dữ liệu; chưa phải mã phiên khởi động ESP32. Nếu tắt/bật trong vòng 5 phút, dữ liệu vẫn có thể nằm trong cùng đợt. Có thể bổ sung bootId/sessionId trong firmware nếu cần tách chính xác mỗi lần khởi động.
- Danh sách tra cứu 7 ngày gần nhất, tối đa 50.000 timestamp gần nhất/chỉ số. Khi chạm giới hạn có thông báo; đầu một đợt chạy dài có thể nằm ngoài phạm vi tra cứu. Dữ liệu MongoDB không bị xóa.

## Hiển thị

- Khoảng đợt đo và tooltip ghi cả ngày tháng năm và giờ Việt Nam, tooltip có giây.
- Trục X co theo khoảng dữ liệu của đợt được chọn, không kéo rộng về 24 giờ. Đợt rất ngắn có thêm lề tối thiểu 30 giây mỗi bên để đọc được; bản ghi đơn lẻ hiện bằng một chấm.
- Chọn đợt cũ thì polling không tự chuyển sang đợt mới. Muốn theo dõi tiếp, bấm Đợt mới nhất.
- Khi chuyển pH/nhiệt độ/độ đục, giữ mã đợt đã chọn nếu chỉ số đó có đợt tương ứng. Nếu không có, báo chưa có đợt phù hợp để người dùng chọn lại.
- Đợt gần nhất không có bản ghi mới trong 30 giây sẽ ghi rõ dữ liệu chưa cập nhật, không gắn nhãn đang chạy.
- Không nối qua giá trị null/invalid. Trường hợp mất dữ liệu được giữ thành các đoạn tách nhau.

## API và truy vấn

`GET /api/sessions?metric=temp` trả `sessions[]` theo thứ tự cũ → mới, `gapMs`, `lookbackDays`, `limit`, `truncated`, `now`. Mỗi session có `id` (timestamp bắt đầu dạng string), `startTs`, `endTs`, `startedAt`, `endedAt`, `count`.

Backend lấy riêng trường `observedAt` qua `Store.historyTimes` và index sẵn có `(deviceId, metric, observedAt)`, thay vì trả toàn bộ lịch sử về browser để chia đợt. Browser chỉ gọi `/api/history` với start/end của đúng đợt đang xem.

Không đổi schema MongoDB, không migration, không xóa hoặc sửa dữ liệu cũ, không thay cơ chế xác thực ThingsBoard hay firmware.

## Kiểm thử

Chạy `npm test`. Đã thêm kiểm thử ba đợt ở các ngày khác nhau; ranh giới đúng 5 phút; chạy liên tục qua nửa đêm; ID đợt ổn định khi có điểm mới; dữ liệu thiếu; timestamp và giới hạn truy vấn; API sessions kết hợp truy vấn đúng phạm vi của đợt.
