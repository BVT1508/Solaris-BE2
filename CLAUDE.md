# Solaris CF

Backend của Solaris viết lại để chạy thẳng trên Cloudflare (Workers). Thay cho backend Express ở `D:\Work\New folder\Solaris BE`, vốn vẫn giữ nguyên để đối chiếu và làm đường lui. Frontend ở `D:\Work\New folder\Solaris FE`.

Solaris: agency nhận đơn, làm sản phẩm bàn giao, khách mở link không cần tài khoản để ghim góp ý theo vòng, team chia việc sửa.

## Đọc trước

- `docs/tien-do.md` của repo này: trạng thái, bước kế tiếp, bẫy đã biết. Cập nhật sau mỗi bước xong và trước khi compact hay bàn giao.
- `docs/kien-truc.md` của repo này: bảng D1, cách thay giao dịch MongoDB, kết nối trực tiếp, cách chia việc.
- Ở repo cũ `Solaris BE`: `docs/api-gop-y.md` (hợp đồng API), `docs/quy-uoc-code.md` (phong cách code của chủ dự án), `docs/ke-hoach-san-pham.md` (hành vi và luật nghiệp vụ phải giữ).

## Quyết định đã chốt với chủ dự án (18/11/2026), không bàn lại

- Một Worker cho tất cả: API, kết nối trực tiếp, và bản build của frontend (static assets). Địa chỉ `*.workers.dev`, gói miễn phí.
- Bộ định tuyến Hono. JavaScript, ES modules, không TypeScript.
- Database D1. Kết nối trực tiếp của màn góp ý bằng một Durable Object giữ WebSocket. Việc định kỳ bằng Cron Triggers.
- Kho file vẫn là Cloudinary, gọi qua HTTP (không dùng SDK Node). R2 để sau.
- **Hợp đồng API không đổi**: đường dẫn, mã trạng thái, hình dạng JSON, lời báo lỗi tiếng Việt giống hệt backend cũ. Mã định danh vẫn là chuỗi 24 ký tự hex như ObjectId.
- Dữ liệu bắt đầu trống, không chuyển từ MongoDB.
- Giới hạn gói miễn phí phải nhớ khi viết: 10 ms CPU mỗi request, 100.000 request mỗi ngày, D1 100.000 dòng ghi và 5 triệu dòng đọc mỗi ngày.

## Luật làm việc

- Trả lời, viết tài liệu, viết chú thích code bằng tiếng Việt.
- **Thước đo xong việc là bản chạy thật trên Cloudflare** (chủ dự án dặn ngày 21/11/2026): sản phẩm phải được deploy và chạy trên Internet; không lấy kiểm thử trên máy dev làm cổng chặn. Có hai bản:
  - Bản chính, team dùng: Worker `app`, D1 `solaris`, `https://app.solaris-fbs.workers.dev`. Không chạy kịch bản tự động vào bản này.
  - Bản thử, cho kịch bản tự động: Worker `app-thu`, D1 `solaris-thu`, `https://app-thu.solaris-fbs.workers.dev`. Bộ đăng nhập và các kịch bản chạy với bản thử nằm ở `D:\Work\New folder\qa-scripts\cf\that\`.
- Bộ Postman của backend cũ (406 request) và `node chay-tat-ca.js` ở `qa-scripts/cf` vẫn là lưới an toàn nhanh khi sửa code (chạy với `wrangler dev`), nhưng không bắt buộc trước mỗi lần deploy.
- Không viết test tự động trong repo, không seed dữ liệu mẫu. Kịch bản thử để ở `D:\Work\New folder\qa-scripts\`.
- Trước khi báo xong một phần: lint sạch, và nêu rõ phần nào đã thử (ở đâu: máy dev, bản thử, bản chính), phần nào chưa.
- Gói miễn phí không bao giờ tính tiền: chạm trần thì request lỗi tới 00:00 UTC. Mọi thứ dính tới thanh toán (nâng gói, dịch vụ trả tiền) phải được chủ dự án duyệt trước.
- Repo này: được commit, không push. Lời commit kiểu của chủ dự án: tiếng Anh, chữ thường, một dòng nói chỉnh cái gì. Mỗi phiên chỉ commit file của phần mình.
- Repo `Solaris BE` và `Solaris FE`: chỉ đọc. Riêng phiên frontend được sửa `Solaris FE`, không commit.
- Tuyệt đối không xóa file quan trọng hay dữ liệu (D1 cục bộ lẫn trên Cloudflare, file trên Cloudinary, tài nguyên Cloudflare) nếu chưa hỏi chủ dự án.
- Không in giá trị khóa bí mật ra màn hình hay vào tài liệu. Khóa cho máy dev nằm ở `.dev.vars` (không commit).
- API của Cloudflare đổi nhanh: tra tài liệu hiện hành (developers.cloudflare.com) trước khi dùng, không dựa vào trí nhớ.
- Deploy do phiên điều phối làm (chủ dự án cho phiên đó toàn quyền deploy; lệnh deploy của các phiên khác bị lớp kiểm quyền từ chối, đừng tìm đường vòng). Phiên khác sửa xong thì commit rồi nhắn phiên điều phối deploy. Cách deploy: `D:\Work\New folder\qa-scripts\cf\x-do-cpu\build-deploy.sh HEAD 0` cho bản chính; thư mục `qa-scripts\cf\that\deploy-thu` cho bản thử.

## Phối hợp

Phiên điều phối là phiên backend `local_819fd873-aa60-4d35-8bf3-376b6cb0641d`. Vướng điều gì cần chủ dự án quyết thì báo phiên điều phối, không tự quyết thay.
