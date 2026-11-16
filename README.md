# AoTom Nexus

Web localhost cho hệ thống ESP32 giám sát ao tôm của nhóm. Backend Node.js, giao diện tiếng Việt bằng HTML/CSS/JavaScript và MongoDB. Không cần build frontend. Không tự thay firmware và không tự gửi lệnh đến mạch khi khởi động.

## Chạy bản mô phỏng

Cài **Node.js 22 trở lên** (khuyên dùng Node.js 24 LTS), giải nén dự án và mở terminal tại thư mục có `package.json`:

```bash
npm install
npm start
```

Mở **http://localhost:3000**. Windows có thể nhấp `start-windows.bat`. Có thể chạy `npm start` ngay trong chế độ demo vì driver MongoDB chỉ được nạp ở chế độ live; `npm install` vẫn cần cho chuyển sang live.

Mặc định `APP_MODE=demo`. Dữ liệu cảm biến, sự kiện mẫu và công tắc là **mô phỏng**; lưu trong RAM và mất khi dừng tiến trình. Thời tiết mẫu có nhãn riêng, hình ao là sơ đồ SVG, không phải ảnh camera. Nút huấn luyện trong demo học từ dữ liệu giả, không có giá trị dự báo thực tế. Tính năng thời tiết thật và camera thật chỉ hoạt động khi chủ động cấu hình.

## Kết nối mạch thật qua ThingsBoard và MongoDB

1. Giữ nguyên luồng **ESP32 → MQTT → ThingsBoard** đang chạy.
2. Cài MongoDB Community trên máy hoặc dùng Docker Desktop. Nếu dùng Docker, chạy:

   ```bash
   docker compose up -d
   ```

   Nếu đã có MongoDB ở cổng 27017, dùng MongoDB hiện tại và bỏ qua Docker.
3. Sao chép `.env.example` thành `.env`. Trên Windows PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

   Trên Linux/macOS:

   ```bash
   cp .env.example .env
   ```
4. Sửa `.env` trên máy của nhóm:

   ```dotenv
   APP_MODE=live
   MONGODB_URI=mongodb://127.0.0.1:27017
   MONGODB_DB=aotom
   TB_URL=https://thingsboard.cloud
   TB_DEVICE_ID=UUID_THIET_BI_CUA_NHOM
   TB_USERNAME=TAI_KHOAN_THINGSBOARD
   TB_PASSWORD=MAT_KHAU_THINGSBOARD
   ```

   `TB_URL` phải đúng máy chủ/vùng đang dùng, ví dụ Cloud US hoặc EU. `TB_DEVICE_ID` là **UUID device**, không phải access token MQTT. Backend cần quyền đọc telemetry và gọi RPC. Có thể dùng `TB_JWT` thay tài khoản/mật khẩu, nhưng JWT đó hết hạn thì phải thay thủ công nếu không có thông tin đăng nhập để tự lấy token mới.
5. Chạy `npm run db:init` để tạo collections, validator và indexes (khởi động live cũng tự chạy bước này). Chạy `npm start`, mở localhost và kiểm tra Cài đặt hiển thị MongoDB / ThingsBoard đã kết nối. Nếu MongoDB không chạy, chế độ live dừng với lỗi; không âm thầm đổi sang dữ liệu giả.
6. So sánh `temp`, `ph`, `turb` và thời điểm đo trên web với Latest telemetry trong ThingsBoard. Khi dữ liệu mới cập nhật, thử điều khiển một thiết bị và kiểm tra trực tiếp relay/motor cùng nhật ký lệnh.

**Không gửi mật khẩu hoặc JWT trong chat, không commit `.env`.** Bí mật chỉ ở backend. Không có SDK theo dõi hoặc CDN trong frontend.

## Những gì bản này đã làm

| Khu vực | Chức năng |
| --- | --- |
| Tổng quan | Nhiệt độ nước, pH, độ đục %, laser; biểu đồ 6h/24h/7 ngày; trạng thái bơm, quạt, Auto |
| Điều khiển | RPC hai chiều `setPump`, `setFan`, `setAuto`; đọc lại `getPump`, `getFan`, `getAuto`; lưu lịch sử |
| Lịch sử | Lọc chỉ số và khoảng 6h/24h/7d/30d; phân trang; xuất CSV tối đa 50.000 điểm/lần |
| Cảnh báo | Vượt ngưỡng, dữ liệu cảm biến thiếu, xâm nhập laser, mất dữ liệu; xác nhận đã xem; tự kết thúc theo điều kiện |
| Thời tiết | Gọi Open-Meteo khi người dùng yêu cầu; giữ bản dự báo đã lấy, 24 giờ theo giờ; quy tắc mưa/gió/nóng |
| Camera | Proxy MJPEG trong LAN; chụp JPEG/PNG; lưu file và metadata MongoDB; mở ảnh đã chụp |
| Phân tích | Huấn luyện baseline tuyến tính theo thời gian, chia 80/20, MAE và so sánh với giữ giá trị cuối, dự báo thử 3h |
| Cài đặt | Tên ao, tọa độ, ngưỡng web; xem 19 collections của thiết kế MongoDB |

## Những giới hạn cần hiểu

- Bản hiện tại phục vụ **một ao, một ESP32, một camera**. Schema có `pondId`/`deviceId` để mở rộng, nhưng API và giao diện chưa có quản lý nhiều ao. Chưa triển khai đăng nhập, phân quyền, hoặc cung cấp truy cập từ Internet. Mặc định chỉ bind `127.0.0.1`.
- `temp` là nhiệt độ nước DS18B20, `turb` là độ đục tương đối %, **không phải NTU**. Firmware hiện tại không gửi độ ẩm tại ao; dữ liệu `humidity` để trống cho tới khi có cảm biến. `weather_runs.hours.humidity` là độ ẩm không khí Open-Meteo, không nhập vào chỉ số đo tại ao.
- Mã trong tài liệu dùng pH **7.5–8.5**; slide ghi **6.5–8.5**. Bản này chọn 7.5–8.5 làm ngưỡng mặc định trên web theo mã. Các ngưỡng dùng cho đồ án, không phải khuyến cáo vận hành cho mọi ao. Web không sửa ngưỡng hay chương trình Auto trong ESP32.
- Khi điều khiển bơm/quạt bằng tay, firmware tắt Auto. Web phản ánh telemetry hoặc RPC, không giả lập trạng thái thành công trong chế độ live. `acknowledged` chỉ xác nhận ESP32 trả lời, không chứng minh cơ cấu vật lý đã hoạt động.
- Lệnh timeout/mất kết nối được đánh dấu **unknown**, vì có thể mạch đã xử lý mà phản hồi bị mất. Không tự retry. Request có idempotency key để tránh gửi trùng trong cùng yêu cầu. Nếu backend chết giữa lệnh, bản ghi `pending` sẽ được đánh dấu `unknown` khi live khởi động lại.
- Chưa có mô hình nhận diện ảnh, gán nhãn qua UI, huấn luyện detector, pipeline GPU, LSTM/XGBoost, lịch tự lấy thời tiết hay tự điều khiển bằng mô hình. Collections mở rộng đã được định nghĩa; không đánh đồng thiết kế với chức năng đã hoàn thành.
- Baseline hiện tại là hồi quy tuyến tính theo timestamp, không có feature thời tiết, không có khoảng tin cậy; có thể kém hơn giữ giá trị cuối. Mỗi lần huấn luyện cần ít nhất 60 điểm hợp lệ, trải dài 3h, điểm mới nhất không quá 30 phút. Dùng tối đa 50.000 điểm trong 7 ngày gần nhất và lưu chính xác khoảng được dùng. Không coi MAE thấp trên một lần test là kiểm chứng ngoài thực tế.
- Cảnh báo web chưa gửi thêm Zalo. Rule Chain trên ThingsBoard vẫn hoạt động độc lập. Còi ở ESP32 được xử lý tại mạch.

## Cấu hình ESP32-CAM

Trong cùng LAN với máy backend, mở thử hai URL camera bằng trình duyệt trên máy của nhóm. Với firmware CameraWebServer phổ biến:

```dotenv
CAMERA_STREAM_URL=http://192.168.1.123:81/stream
CAMERA_CAPTURE_URL=http://192.168.1.123/capture
```

Đây chỉ là IP ví dụ; dùng IP thật và đường dẫn đúng firmware camera. Khởi động lại backend, vào Camera & an ninh và bấm Xem trực tiếp hoặc Chụp & lưu ảnh. Stream được bật theo yêu cầu, tự hết phiên sau tối đa 10 phút; bấm xem lại nếu cần. Ảnh chụp tối đa 5 MB, lưu trong `data/images`, MongoDB chỉ lưu metadata. Chưa kích chụp tự động từ laser. Sao lưu cả thư mục ảnh khi sao lưu DB. Nếu thử camera trong chế độ demo, metadata nằm trong RAM và sẽ mất khi restart, dù file ảnh còn trên ổ đĩa; dùng live để lưu metadata bền vững.

## Thời tiết

Vào Cài đặt, nhập tọa độ ao và lưu; vào Thời tiết, bấm Lấy dự báo thật. Backend chỉ gửi tọa độ đến `api.open-meteo.com`, không gửi telemetry hay ảnh. Lần lấy cùng tọa độ được cache tối thiểu 10 phút. Không tự lấy định kỳ. Dự báo cũ luôn giữ `fetchedAt`; khi đổi vị trí, dữ liệu cũ không còn hiển thị cho vị trí mới. Mưa/gió/nóng chỉ tạo cảnh báo web, không suy ra pH hay nhiệt độ nước. Open-Meteo có điều kiện sử dụng riêng; bản demo dùng API không có key cho mục đích học tập phi thương mại. Xem tài liệu nguồn trong `docs/MONGODB.md`.

## Đồng bộ dữ liệu

Backend định kỳ gọi REST time series ThingsBoard, mặc định mỗi 5 giây, nhập lùi 24h trong lần đầu. Mỗi key có cursor riêng trong `ingestion_state`, lấy trang 1000 điểm, giữ `observedAt` gốc. Mỗi chu kỳ đọc chồng 60 giây để nhận dữ liệu tới trễ trong khoảng đó, unique index chống trùng; restart tiếp tục từ cursor đã lưu. Có giới hạn 200 trang/key/chu kỳ; lần sau tiếp tục nếu chưa kịp. Với dữ liệu backdated quá 60 giây, cần reset cursor về thời điểm muốn nhập lại (xem MONGODB.md). Sau lần đầu có thể chỉnh `TB_BACKFILL_HOURS` từ 1 tới 168 trước khi khởi tạo cursor.

Khoảng trống không tự nội suy, null không bị ép thành 0. Khi dữ liệu cảm biến cũ hơn 30 giây, UI báo dữ liệu cũ, khóa điều khiển nếu không có trạng thái tươi. Theo dõi live cần backend chạy; khi máy tắt, ThingsBoard tiếp tục nhận dữ liệu theo cơ chế hiện tại, backend sẽ nhập bù phần còn lưu trên ThingsBoard khi chạy lại.

## Kiểm thử và cấu trúc

```bash
npm test
```

Kiểm thử gồm dữ liệu null, chống trùng, cảnh báo, train/test theo thời gian, API localhost, CSRF, idempotency lệnh và ThingsBoard giả lập. Mock ThingsBoard không thay thế kiểm thử mạch thật.

Kiểm tra MongoDB thực sau khi có dịch vụ dành cho kiểm thử:

```powershell
$env:MONGO_TEST_URI="mongodb://127.0.0.1:27017"
node tests/mongodb.integration.js
```

Script tạo rồi xóa một DB ngẫu nhiên có tiền tố `aotom_test_`, không dùng tên DB vận hành. Môi trường tạo gói chưa khởi động được tiến trình mongod nên chưa xác nhận bài kiểm thử MongoDB thực; cần chạy trên máy nhóm.

```text
public/            Giao diện, CSS, SVG; không CDN
src/server.js      HTTP API, localhost, camera, thời tiết, lệnh
src/domain.js      Chuẩn hóa dữ liệu, quy tắc cảnh báo, baseline
src/database.js    MongoDB indexes/validator, Store, seed demo
src/thingsboard.js Đồng bộ REST, JWT, RPC hai chiều
scripts/init-db.js Khởi tạo MongoDB
docs/MONGODB.md   Thiết kế collections, quan hệ và chiến lược mở rộng
docs/API.md       Hợp đồng API backend
tests/            Kiểm thử domain, ThingsBoard giả lập và HTTP API
.env.example       Cấu hình mẫu, không bí mật
```

