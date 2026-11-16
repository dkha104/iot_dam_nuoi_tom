# API localhost

Mọi route cùng origin, không bật CORS. GET `/api/state` trả token thao tác; POST phải kèm header `X-App-Token` đó. Token chống CSRF cho phiên backend cục bộ, không phải tài khoản hoặc cơ chế phân quyền. Server chỉ bind 127.0.0.1, từ chối Host lạ và request có Sec-Fetch-Site cross-site. Không đặt secret ThingsBoard trong bất kỳ payload frontend nào.

| Method | Route | Ý nghĩa |
| --- | --- | --- |
| GET | `/api/state` | Chế độ, dữ liệu mới nhất, settings, trạng thái kết nối, lệnh, alert, ảnh, model |
| GET | `/api/history?metric=ph&start=...&end=...&limit=2000` | Khoảng start/end epoch ms, tối đa 31 ngày, limit tối đa 50.000; ASC |
| GET | `/api/export?metric=ph&start=...&end=...` | CSV số liệu cảm biến, tối đa 50.000 điểm gần nhất trong khoảng; không export chuỗi alerts |
| POST | `/api/sync` | Kéo dữ liệu ThingsBoard; 409 nếu worker đang chạy |
| POST | `/api/commands` | `{method:"setPump",value:true,idempotencyKey:"UUID"}`; lưu trước khi gửi |
| POST | `/api/alerts/{id}` | Xác nhận đã xem, không tắt cảnh báo vật lý |
| POST | `/api/settings` | Toàn bộ pondName, latitude/longitude hoặc null, thresholds và weather; validator bắt buộc |
| POST | `/api/weather/refresh` | Lấy dự báo thật theo tọa độ; cache 10 phút cho cùng vị trí |
| GET | `/api/camera/stream` | Proxy stream MJPEG từ URL env, không nhận URL tùy ý từ browser |
| POST | `/api/camera/capture` | Chụp và lưu ảnh; 409 nếu chưa có URL |
| GET | `/api/media/{id}` | Đọc ảnh đã lưu của camera |
| POST | `/api/models/train` | `{metric:"temp"}`; train tuyến tính thử nghiệm; 409 khi dữ liệu không đủ hoặc cũ |
| GET | `/api/schema` | Danh sách 19 collections và vai trò |

Lỗi trả JSON `{error:"..."}`. Backend không trả stacktrace hay nội dung lỗi kết nối DB có thể chứa URI. Lệnh RPC lỗi trả bản ghi command có `status` và `error`; phía gọi cần xử lý cả HTTP 502 lẫn trạng thái. Không tự retry lệnh có kết quả unknown. Backend crash: pending cũ chuyển unknown khi khởi động lại.

Telemetry gồm một record/key/thời điểm với timestamp gốc. `/api/history` trả `truncated=true` khi số bản ghi chạm limit (có thể là đúng bằng giới hạn). Xuất dữ liệu dài cần chia nhỏ cửa sổ thời gian. Dữ liệu số hiển thị theo vi-VN trong UI nhưng CSV dùng dấu chấm thập phân để pipeline ML đọc được.

Luồng camera/thời tiết cần backend ở cùng LAN / có Internet tương ứng. Không có route nhận ảnh người dùng upload, đổi bí mật, xóa lịch sử, đăng nhập hay gán nhãn trong bản đầu.
