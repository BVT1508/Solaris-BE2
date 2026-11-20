# Tiến độ phiên code Y

Cập nhật: 18/11/2026, khoảng 23:30. Phiên Y làm các gói Y1, Y2, Y3, Y4 theo `docs/kien-truc.md` mục 12. **Đọc mục "Bàn giao" ngay dưới trước**; các mục sau là chi tiết.

## Bàn giao (đọc phần này là làm tiếp được)

Viết cho chính phiên Y sau khi context bị nén, hoặc cho phiên khác nhận việc. Cập nhật lần cuối: 18/11/2026, 23:30.

### ĐANG LÀM (21/11/2026): công cụ chuyển dữ liệu cũ từ MongoDB Atlas sang D1

Phiên điều phối giao (theo yêu cầu của chủ dự án): viết và chạy thử công cụ chuyển dữ liệu. Mọi thứ ghi vào `D:\Work\New folder\qa-scripts\cf\chuyen-du-lieu\`. KHÔNG ghi vào D1 thật, KHÔNG deploy, KHÔNG xóa gì; việc áp lên bản chính do phiên điều phối làm.

- Nguồn: database `solaris` trên Atlas (chuỗi kết nối ở `MONGODB_URI` trong `Solaris BE/.env`, đọc bằng code, không in ra): 1 tổ chức, 4 thành viên, 7 khách hàng, 7 đơn, 8 sản phẩm, 25 vòng, 10 link, 43 góp ý, 1736 dòng nhật ký; `sessions`, `oauthstates` trống (bỏ).
- Đích (bản chính): tổ chức id `6afdc82fa3128299dd04f7ce`, chủ hệ thống id `6afdc82fd1a9424a6bf8f4d8`. Ghép vào, không xóa gì: id tổ chức cũ đổi thành id tổ chức đích, id chủ hệ thống cũ (tìm theo email `OWNER_EMAIL`) đổi thành id chủ hệ thống đích ở MỌI chỗ (cột lẫn JSON lồng); không chèn dòng tổ chức và dòng chủ hệ thống của nguồn; mọi id khác giữ nguyên.
- Bốn việc: (1) `xuat-mongo.js` xuất chỉ đọc ra JSON giữ kiểu (ObjectId, Date); (2) `chuyen.js --org <id> --owner <id>` sinh file SQL đúng dạng code mới ghi và đọc (dùng lại hàm của repo cho cột suy ra), chia file theo giới hạn của D1, thứ tự theo khóa ngoại, từ chối chạy nếu đích đã có id sắp chèn, in bảng đếm, liệt kê trường bị bỏ; (3) chạy thử trên D1 cục bộ ở `.wrangler/state-chuyen`, cổng 4004: đếm dòng, đối chiếu JSON của các GET chính với backend cũ cho từng tài khoản và từng link còn sống, thử ghi tiếp (góp ý mới, mở vòng kế, sửa đơn); (4) `README.md` với lệnh cho bản chính và cách kiểm.
- **Điểm lệch có chủ ý so với lời giao việc, vì an toàn dữ liệu thật:** KHÔNG chạy backend cũ trỏ vào Atlas. Lúc khởi động backend cũ chạy `scheduleVersionPurge` (sửa `files` của đơn đã bàn giao quá 30 ngày và xóa file trên Cloudinary thật) và `schedulePendingPurge` (xóa file tạm trên Cloudinary thật); `GET /r/:token` tăng lượt mở link. Cách làm thay: nạp file xuất vào MongoDB cục bộ (mongod của `qa-scripts/cf/goc.js`, cổng 27219, database riêng), chạy backend cũ trên bản sao đó ở cổng riêng với `CLOUDINARY_URL` GIẢ (cùng tên cloud giả ở cả backend cũ lẫn `wrangler dev` cổng 4004, để URL ký giống nhau mà không lời gọi nào chạm kho thật). Atlas chỉ bị đọc một lần lúc xuất.
- Trạng thái lúc ghi: chưa bắt đầu viết. Cập nhật khối này sau mỗi bước.

### Đợt việc thứ tư của phiên điều phối (XONG 19/11/2026, khoảng 02:10)

| Việc                                  | Kết quả                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Thử `purgeDeliveredVersions`       | `qa-scripts/cf/thu-don-ban-cu.js`, kích bằng `cron=job:ban+cu` (không kích cả nhóm cron): 32/32 phép đạt. Đơn quá 30 ngày: sản phẩm chỉ còn file đang dùng, `version` tăng đúng 1, file cũ và ảnh trang của vòng cũ vào `storage_trash`, có mốc `versions_purged_at`. Đơn chưa quá 30 ngày không bị dọn; chạy lại lần hai không đổi gì; đơn đã mở lại không bị dọn, không mang mốc. Bốn lượt "mở lại rồi đính file" bắn cùng lúc với việc dọn: không 5xx, file vừa đính không mất, không file nào vừa trong sản phẩm vừa trong thùng rác. Không phải sửa `maintenanceService.js`. Giới hạn: cả bốn lượt kết thúc theo cùng một thứ tự (mở lại thắng), nhánh "việc dọn thắng rồi mới mở lại" chưa được chạm. |
| 2. Lỗi ngắt kết nối                   | Trình duyệt thật không bị (phiên frontend đã thử). `thu-realtime-y.js` có cách tránh (khách gửi `deliverable:watch` trước khi bị ngắt, ghi rõ trong file), giờ 27/27. `thu-ngat-ket-noi.js` giữ lại để tái hiện hiện tượng của Node 22 trên `wrangler dev`.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 3. Chuyển nốt kịch bản cũ, mục README | 12 kịch bản còn lại đã chuyển sang `qa-scripts/cf/cu/` (bảng dưới). `qa-scripts/cf/README.md` có mục "Chạy lại toàn bộ kiểm thử của đợt viết lại". Bộ chạy một lệnh: `qa-scripts/cf/chay-tat-ca.js` (32 bước, so với số kỳ vọng).                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Kịch bản cũ chuyển trong đợt này (tôi đã chạy lại tất cả bằng `chay-tat-ca.js`, khớp báo cáo của các tác tử phụ; chi tiết ở `qa-scripts/cf/cu/ket-qua-nhom-4.md` và `ket-qua-nhom-5.md`):

| Kịch bản                                   | Đạt            | Phép trượt và lý do                                                                                                                                              |
| ------------------------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `t2_flow.js`                               | 76/76          |                                                                                                                                                                  |
| `t3_lifecycle.js`                          | 37/41          | T20, T21, V01, A4: kịch bản cho nhân viên mở vòng; luật leader (có từ backend cũ, `policy.js` hai bản giống nhau) trả 403. Đối chứng cho quản lý mở vòng: 41/41. |
| `t5_perf_db.js`                            | 7/7            | Đã bỏ phần profiler của MongoDB.                                                                                                                                 |
| `t6_extra.js`                              | 9/9            |                                                                                                                                                                  |
| `t7_verify_be.js`                          | 10/10          | Lúc mới chuyển 8/10 (BN7b, BN7c: charset và content-encoding lạ không còn trả 415); phiên X đã sửa ở `8b6c544`.                                                  |
| `t8_rules_v2.js`                           | 69/74          | RN3 đến RN7: cùng lý do như `t3`. Đối chứng với admin: 74/74.                                                                                                    |
| `t9_hardening.js`                          | 47/47          | 49/49 khi đặt `QA_BE_LOG` trỏ tới log của `wrangler dev`.                                                                                                        |
| `be_kiem_sua_nhanh.js`                     | 32/32          | Lúc mới chuyển 30/32 (hai phép K1, cùng lỗi 415 ở trên, đã sửa ở `8b6c544`).                                                                                     |
| `be_kiem_tim_kiem.js`                      | 12/12          |                                                                                                                                                                  |
| `be_kiem_chat_truc_tiep.js`                | 32/32          | Socket.IO đổi sang WebSocket thường; có cùng cách tránh cho Node 22.                                                                                             |
| `nghe_su_kien.js`, `kiem_du_lieu_gop_y.js` | thử khói 14/14 | Hai công cụ phụ cho kiểm thử giao diện; chỉ thử khói bằng `_nhom5_thu_khoi.js`.                                                                                  |

**Lượt chạy đủ bằng `node chay-tat-ca.js`** (D1 trống, cổng 4002, code tới `8b6c544`): 32/32 bước khớp kỳ vọng. Lượt đầu 28 bước khớp; 4 bước lệch đều do phía kiểm thử, đã sửa và chạy lại khớp: số kỳ vọng của `thu-dong-thoi.js` là 37 (tôi ghi nhầm 39), `t7` và `be_kiem_sua_nhanh` đạt hết sau khi phiên X sửa 415, `thu-y2.js` giả định mọi dòng hoạt động do chủ hệ thống làm (chỉ đúng sau Postman 03, sai sau Postman đủ bộ; đã sửa kịch bản). Tổng các bước: bộ Postman 1377/1377, và 1.070 phép của các kịch bản khác.

**Đã báo phiên điều phối, file dùng chung:** (1) ngắt kết nối với Node 22 ở `realtimeHub.js` (ưu tiên thấp, trình duyệt không bị); (2) 415 cho charset và content-encoding lạ ở `bodyMiddleware.js` (phiên X đã sửa ở `8b6c544`).

Thư viện `qa-scripts/cf/cu/lib-cf.js`: gửi lại một lần khi kết nối giữ sẵn bị đóng (`ECONNRESET` sau khi `d1()` chặn tiến trình); `ownerEmail()` chọn admin được tạo sớm nhất. Bẫy: nhiều luồng chạy cùng lúc trên một server dễ chạm trần 600 request mỗi phút; `chay-tat-ca.js` nghỉ giữa các bước và tự chạy lại một lần khi gặp 429.

### Đợt việc thứ ba của phiên điều phối (xong 19/11/2026, khoảng 00:35, trừ việc 4)

Năm việc được giao: (1) chạy kịch bản cũ, (2) bắn đồng thời, (3) WebSocket thật, (4) thử `purgeDeliveredVersions`, (5) đo và giảm bước kiểm zod của ảnh trang. Kết quả:

| Việc             | Kết quả                                                                                                                                               | Còn lại                                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Kịch bản cũ   | 8 kịch bản ưu tiên (và `t1` để có `state.json`) đã chép sang `qa-scripts/cf/cu/`, không sửa file gốc. Không tìm ra lỗi nào của code mới. Bảng ở dưới. | Chưa chuyển: `t2`, `t3`, `t5` đến `t9`, `be_kiem_sua_nhanh`, `be_kiem_tim_kiem`, `be_kiem_chat_truc_tiep`, `nghe_su_kien`, `kiem_du_lieu_gop_y`. |
| 2. Bắn đồng thời | `qa-scripts/cf/thu-dong-thoi.js`, năm loạt, 37 phép đều đạt. Không có 5xx, không có 409 oan, dữ liệu đọc lại từ D1 đúng. Bảng ở dưới.                 |                                                                                                                                                  |
| 3. WebSocket     | `qa-scripts/cf/thu-realtime-y.js`: 25 trên 26 phép đạt. Phép trượt là lỗi ở lớp dùng chung (dưới), đã báo phiên điều phối trong báo cáo cuối lượt.    | Chờ phiên X sửa rồi chạy lại.                                                                                                                    |
| 4. Dọn bản cũ    | Chưa làm: chờ phiên X cho cách kích riêng từng việc định kỳ. Không kích cả nhóm cron.                                                                 | Khi có: xem "Bước kế tiếp" số 1.                                                                                                                 |
| 5. Zod ảnh trang | Đo và sửa xong, commit `7936721`. Chi tiết ở dưới.                                                                                                    |                                                                                                                                                  |

**Việc 1, từng kịch bản** (tôi đã tự chạy lại cả tám sau khi các tác tử phụ báo, kết quả khớp; chi tiết và cách dịch từng lệnh MongoDB ở `qa-scripts/cf/cu/ket-qua-nhom-{1,2,3}.md`):

| Kịch bản                                              | Đạt   | Phép trượt và lý do                                                                                                                                                                           |
| ----------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `be_kiem_tranh_chap.js`                               | 4/4   |                                                                                                                                                                                               |
| `be_kiem_mo_lai_don.js`                               | 15/15 |                                                                                                                                                                                               |
| `be_kiem_sua_nghiep_vu.js`                            | 45/45 |                                                                                                                                                                                               |
| `t4_states_concurrency.js`                            | 46/46 | Loạt bắn C01 đến C07: không 5xx; 409 "Dữ liệu vừa thay đổi" chỉ ở C02 là loạt gửi version cũ thật.                                                                                            |
| `be_kiem_leader.js`                                   | 51/52 | "Vòng cũ không có bản chụp": kịch bản dựng vòng không có `files` bằng lệnh ghi thẳng database. Bản mới cố ý bỏ nhánh vòng cũ (`kien-truc.md` mục 2.2, dữ liệu bắt đầu trống). Không phải lỗi. |
| `be_kiem_nhat_ky.js`                                  | 29/29 | Đã bỏ 2 phép về `backfillActivity.js` (bản mới không có việc đó).                                                                                                                             |
| `be_kiem_anh_gop_y.js`                                | 22/22 |                                                                                                                                                                                               |
| `be_kiem_cong_cu_gop_y.js`                            | 25/25 |                                                                                                                                                                                               |
| `t1_members_orders.js` (chỉ để dựng dữ liệu cho `t4`) | 72/73 | O15 "hai khách mới trùng tên được ghép": backend cũ cũng không ghép (tác tử đọc mã cũ, chưa chạy backend cũ để so). Không phải lỗi của bản mới.                                               |

Giới hạn của việc 1: không chạy lại trên backend cũ để so từng response; các loạt bắn của kịch bản gốc chỉ 2 đến 4 request; nhánh "hết 3 lượt chạy lại thì 409" của `transact` chưa lần nào bị chạm.

**Việc 2, từng loạt** (`node thu-dong-thoi.js [team gui vong gopy file]`, chạy trên `wrangler dev` cục bộ):

| Loạt   | Bắn gì                                                                                   | Kết quả                                                                                                                                                                                                                         |
| ------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `team` | 14 lần lưu team liên tiếp, cùng lúc ba người đổi vai trò ba thành viên, mỗi người 10 lần | Lưu team: 9 lần 200, 5 lần 400 "Quản trị viên thấy mọi đơn hàng nên không cần gán." (đúng luật). Đổi vai trò: 30 lần 200. Không viewer nào là leader, không admin nào trong `order_members`, không trùng vị trí, 0 lần 409 oan. |
| `gui`  | 16 nháp mới từ ba link cùng lúc với 3 lần bấm gửi                                        | Đúng một lần gửi 200. 7 nháp kịp đi cùng lượt gửi, 9 nháp nhận 409 "Vòng góp ý đã khép...". 0 nháp kẹt, số thứ tự 1 đến 8 liền nhau, nhật ký ghi đúng 8.                                                                        |
| `vong` | 4 vòng, mỗi vòng 12 lần "Gửi khách xem lại" cùng lúc                                     | Mỗi vòng đúng một 201, 11 lần 409 "Vòng hiện tại còn mở...". Số vòng 1 đến 5 liền nhau, 4 dòng nhật ký.                                                                                                                         |
| `gopy` | 14 góp ý của khách, 6 của team, 4 lần gửi cùng `clientId`, tất cả cùng lúc               | 21 lần 201, 3 lần 200 (trả bài đã có). 21 bài, số thứ tự 1 đến 21 liền nhau, bộ đếm của sản phẩm bằng 21.                                                                                                                       |
| `file` | 6 lần đính file liên tiếp cùng lúc với 12 lần "Cập nhật bản đang gửi" (Cloudinary thật)  | Cả 18 request 200. 7 file đang dùng, không trùng, vòng 1 chụp đúng bộ file sau lượt cập nhật cuối.                                                                                                                              |

Không loạt nào để lại dòng trong `tx_guard`. Giới hạn: máy dev không có trần CPU và chỉ một isolate; chưa bắn trên Cloudflare thật.

**Việc 3: lỗi ở file dùng chung, phiên Y không sửa.** `src/realtime/realtimeHub.js`. Kết nối WebSocket nào CHƯA TỪNG gửi lệnh (khách thì luôn như vậy, vì khách không cần gửi `deliverable:watch`) khi bị server ngắt (`disconnect(tag)`, mã 4000: thu hồi link, lưu trữ sản phẩm, đăng xuất) thì phía client kẹt ở trạng thái đang đóng (`readyState` 2) và không nhận được sự kiện `close` kèm mã 4000 (đã chờ 10 giây, WebSocket của Node 22). Kết nối đã gửi ít nhất một lệnh thì đóng đúng mã 4000. Tái hiện: `node qa-scripts/cf/thu-ngat-ket-noi.js` (bốn trường hợp). Chỉ thử trên `wrangler dev` cục bộ; chưa biết Cloudflare thật và trình duyệt thật có như vậy không. Hệ quả nếu đúng cả ở đó: khách đang mở link bị thu hồi không được báo cho tới khi tự tải lại (server đã thôi gửi sự kiện cho kết nối đó, nên không lộ dữ liệu). Phần còn lại đều đúng: `submitted`, `round`, `approved` tới team và mọi khách của sản phẩm; kết nối gửi kèm `X-Socket-Id` không nhận lại sự kiện của chính nó; phía khách `actor` chỉ có `kind`; nối lại bằng token đã thu hồi nhận 404 và mã 4404; nhân viên bị gỡ khỏi team bị ngắt mã 4000 và xin theo dõi lại bị từ chối.

**Việc 5: bước kiểm của `PUT /deliverables/:id/rounds/current/pages`.** Đo bằng Node trên máy dev (`qa-scripts/cf/do-zod-anh-trang.mjs`), payload lớn nhất được phép (30 trang, mỗi trang 300 ghim, 531 KB): `JSON.parse` khoảng 3 ms; zod khoảng 7 ms. Với 30 trang, 100 ghim mỗi trang (181 KB): zod 2,3 ms. Đã thêm đường kiểm nhanh viết tay `fastRoundPages` trong `validators/roundValidator.js`: payload hợp lệ đi đường nhanh (kết quả giống hệt zod), payload nào không chắc hợp lệ thì giao nguyên cho schema zod, nên lời báo lỗi do zod sinh ra, không đổi. Sau khi sửa: payload lớn nhất còn khoảng 1,2 ms. So đường nhanh với zod bằng 30.000 payload ngẫu nhiên (hợp lệ và bị làm hỏng một chỗ): không lệch lần nào (`qa-scripts/cf/so-kiem-nhanh-anh-trang.mjs`). Còn lại: payload lớn nhất mà SAI vẫn tốn cả hai đường (khoảng 9 ms), chỉ người cố ý gửi sai mới gặp và chỉ request của họ chịu; `JSON.parse` 3 ms nằm ở `bodyMiddleware.js` dùng chung, không giảm được ở gói Y. Sửa schema thì phải sửa cả `fastRoundPages` và chạy lại kịch bản so.

Sửa nhỏ đi kèm (`7936721`): số vòng trong nhật ký `round.submit`, `round.open`, `round.approve` được ghi là `1.0` (D1 gắn số của JavaScript thành REAL trong `json_object`); đã ép về số nguyên. Câu chữ ở "Hoạt động" trước đó vẫn đúng.

Sau mọi thay đổi của đợt này: cả bộ Postman trên dữ liệu trống ở cổng 4002 vẫn 406 request, 1377 phép kiểm, 0 lỗi (`qa-scripts/cf/ket-qua/` file nhãn `y-dot-3`); `npm run lint` sạch.

### Đã xong và commit nào

| Việc                                                            | Commit                                      | Trạng thái                                                        |
| --------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| Y1 khách hàng, đơn hàng                                         | `8f01469`                                   | xong, Postman 03 qua                                              |
| Y2 hoạt động của đơn                                            | `8187393`                                   | xong, nằm trong Postman 12, qua                                   |
| Y3 link chia sẻ, `guestMiddleware.js`, `GET /r/:token`          | `5b2682f`                                   | xong, Postman 05 qua                                              |
| Y4 vòng review, ảnh trang, dọn bản cũ                           | `1c1e178`                                   | xong, Postman 07, 11, 12 qua; riêng việc dọn bản cũ chưa chạy thử |
| Sửa theo bản soát thiết kế (điểm 1, 4, 7, 8, 11, 19)            | `092e946`                                   | xong                                                              |
| Ảnh trang nhận bằng một lời gọi kho                             | `07864d2`                                   | xong                                                              |
| Đường kiểm nhanh cho bộ ảnh trang; số vòng nguyên trong nhật ký | `7936721`                                   | xong                                                              |
| Ghi chú tiến độ                                                 | `2f643b9`, `75d7006`, và commit của mục này |                                                                   |

Lần chạy đủ bộ gần nhất (sau mọi thay đổi trên, D1 trống, cổng 4002): 406 request, 1377 phép kiểm, 0 lỗi. Báo cáo: `qa-scripts/cf/ket-qua/2026-11-18_232006_y-anh-trang-1-loi-goi.md`. `npm run lint` sạch. Chưa push gì (luật: không push).

### Đang dở

Không có việc nào đang viết dở. Cây làm việc sạch sau commit của mục này (kiểm bằng `git status --short`; file `src/` đã sửa mà chưa commit là của phiên X, đừng đụng).

### Bước kế tiếp, theo thứ tự

Không còn việc nào được giao mà chưa làm. Việc có thể làm khi được giao tiếp:

1. **Chấm lại cả hệ thống sau mỗi thay đổi lớn**: làm trống dữ liệu, rồi `node chay-tat-ca.js` (từ `qa-scripts/cf`). Số kỳ vọng nằm trong chính file đó và trong `qa-scripts/cf/README.md`.
2. **Việc dọn bản cũ, nhánh chưa chạm**: dựng tình huống việc dọn chạy xong rồi đơn mới được mở lại (mốc phải bị xóa bởi `reopenOrder`).
3. **Giảm lượt đọc lại đơn sau lô** trong `orderService.js` (`readPublic`): không gấp, một lượt tới D1 chỉ khoảng 0,5 ms.
4. **Chạy trên Cloudflare thật**: mọi kịch bản mới chỉ chạy trên `wrangler dev`.

### Lệnh chạy và cổng của phiên Y

- Server thử: cổng **4002**, inspector **9232**, dữ liệu riêng ở `.wrangler/state-y`, log ở `.wrangler/dev-y.log`. Không dùng cổng 4000, 4001; không đụng `.wrangler/state`, `.wrangler/state-x`; không chạy `npm run db:reset`.
- Bật (từ thư mục `Solaris CF`, chạy nền): `npx wrangler dev --port 4002 --persist-to .wrangler/state-y --inspector-port 9232`
- Tắt: `node y-server.js tat` (từ `qa-scripts/cf`). Làm trống dữ liệu: `node y-server.js lam-trong --khong-bat`, rồi bật lại bằng lệnh trên.
- Chấm: `node chay-postman.js --base-url http://127.0.0.1:4002/api/v1` (cả bộ), thêm `-t 07` cho một thư mục (tự kéo theo thư mục phụ thuộc), `--nhan <chữ>` để đặt tên báo cáo. Mỗi lượt đủ bộ phải bắt đầu từ dữ liệu trống.
- Kịch bản thử riêng (từ `qa-scripts/cf`): `node thu-y34.js` (link, vòng, bấm cùng lúc), `node thu-diem1.js` (điểm 1 của bản soát), `node thu-y2.js` (hoạt động, chạy sau Postman 03). `thu-y1.js` chỉ dùng khi chưa có gói thành viên.
- Commit: `git add <file mới>` rồi `git commit -m "<lời tiếng Anh, chữ thường, một dòng>" -m "Co-Authored-By: ..." -- <đường dẫn>`, chỉ file của phiên Y. Không push.

### Luật làm việc phải nhớ

- Chỉ sửa file của gói Y (bảng ở `kien-truc.md` mục 12) và `docs/tien-do-y.md`. File dùng chung và file của phiên X cần sửa thì nhắn phiên điều phối `local_819fd873-aa60-4d35-8bf3-376b6cb0641d`, không tự sửa.
- Không sửa `Solaris BE`, `Solaris FE`, bộ Postman. Không in khóa bí mật (`.dev.vars`, `.env`). Chỉ tắt tiến trình của mình.
- Kịch bản thử để ở `qa-scripts/cf/`, không để trong repo.

### Bẫy đã gặp

- `y-server.js bat` (bật tách rời bằng Node) không lên trên máy Windows này; bật bằng lệnh `npx wrangler dev ...` chạy nền.
- Lệnh tắt tác vụ nền báo "failed" cho tác vụ `wrangler dev` mỗi khi tôi tắt server bằng `y-server.js tat`: đó là do mình tắt, không phải lỗi.
- `wrangler d1 execute --command "<SQL>"` qua `child_process` với `shell: true` làm vỡ câu SQL; gọi thẳng `node node_modules/wrangler/bin/wrangler.js ...`.
- Heredoc của Git Bash vỡ khi nội dung có dấu backtick hoặc `${}`: viết script vá ra file rồi chạy.
- Bộ Postman chạy lần hai trên cùng dữ liệu trượt `03 / Staff không còn đơn nào` (cả backend cũ cũng vậy): không phải lỗi.
- Postman CLI in các `pm.sendRequest` là "[errored] Could not read response data." dù chúng thành công; `chay-postman.js` đã xử lý, đừng đọc tay rồi tưởng lỗi.
- Header HTTP không nhận chữ có dấu (`fetch` ném lỗi ByteString): giá trị thử cho `X-Device-Id` phải là ASCII.
- `chay-postman.js` mặc định cổng 4000: luôn nêu `--base-url` khi chấm server của mình.

### Điểm của `docs/soat-thiet-ke.md`

- **Đã xử lý:** 1 (phần #6 và #8), 4, 7, 8, 11, 19 (phần `setCurrentPages`). Chi tiết ở mục "Xử lý kết quả soát thiết kế".
- **Đã soát, không phải sửa:** 10, 14, 15, 20.
- **Không thuộc phiên Y:** 2, 3, 5, 6, 9, 12, 13, 17, 18, 21 (phiên X).
- **Còn mở:** điểm 4 mới sửa code, chưa chạy thử (bước kế tiếp số 1). Điểm 19, hai phần còn lại (trần 300 góp ý, `verdictByGuest`) nằm trong `feedbackService.js` của phiên X.

### Tin nhắn của phiên điều phối

| Tin                                                                                                                        | Trạng thái                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Giao gói Y1 đến Y4                                                                                                         | xong                                                                                                                                                               |
| Kết quả soát thiết kế, phần của Y                                                                                          | xong, trừ việc thử điểm 4                                                                                                                                          |
| Tin CPU sát 10 ms: gom đọc bằng `readAll`, tránh đọc lại, không dựng schema trong request                                  | đã bớt hai truy vấn (khách mở link, `listAssignableMembers`); việc đọc lại đơn sau lô còn giữ, xem bước kế tiếp số 3. Schema zod của phiên Y đều dựng ở cấp module |
| Phiên X quyết `updateMember` có tăng `version` của đơn không                                                               | phiên X đã chốt là không (ghi ở `kien-truc.md` mục 3.2); code của phiên Y không phụ thuộc quyết định đó                                                            |
| Ghi mục bàn giao này và giữ nó cập nhật sau mỗi gói; context vượt khoảng 90% thì ghi xong rồi mới làm tiếp                 | đang làm theo                                                                                                                                                      |
| Cách thử việc dọn bản cũ                                                                                                   | phiên điều phối đã trả lời: phiên X sẽ cho cách kích riêng từng việc định kỳ, chờ tin                                                                              |
| Đợt việc thứ ba (kịch bản cũ, bắn đồng thời, WebSocket, dọn bản cũ, zod ảnh trang)                                         | xong việc 1, 2, 3, 5; việc 4 chờ phiên X; lỗi ngắt kết nối ở `realtimeHub.js` đã báo                                                                               |
| Đợt việc thứ tư (thử dọn bản cũ bằng `job:ban+cu`, cách tránh cho kịch bản realtime, chuyển nốt kịch bản cũ và mục README) | xong cả ba                                                                                                                                                         |

## Kết quả

Bộ Postman của backend cũ (406 request, 1377 phép kiểm, không sửa gì), chạy bằng `qa-scripts/cf/chay-postman.js` với server của phiên Y ở `http://127.0.0.1:4002/api/v1`, D1 cục bộ trống (`.wrangler/state-y`), gồm cả phần của phiên X đã commit tới `b9d08c2`:

| Thư mục                                         | Request | Phép kiểm | Đạt  | Lỗi | Thiếu |
| ----------------------------------------------- | ------- | --------- | ---- | --- | ----- |
| 01 Auth                                         | 7       | 29        | 29   | 0   | 0     |
| 02 Thành viên                                   | 20      | 74        | 74   | 0   | 0     |
| 03 Đơn hàng                                     | 52      | 169       | 169  | 0   | 0     |
| 04 Sản phẩm bàn giao                            | 48      | 162       | 162  | 0   | 0     |
| 05 Link chia sẻ                                 | 41      | 143       | 143  | 0   | 0     |
| 06 Góp ý của khách                              | 46      | 157       | 157  | 0   | 0     |
| 07 Vòng review                                  | 119     | 409       | 409  | 0   | 0     |
| 08 Lỗi chung                                    | 3       | 12        | 12   | 0   | 0     |
| 09 Bảo mật                                      | 4       | 17        | 17   | 0   | 0     |
| 10 Thử upload ảnh                               | 10      | 30        | 30   | 0   | 0     |
| 11 Bàn giao, mở lại đơn và luật mới             | 24      | 73        | 73   | 0   | 0     |
| 12 Leader theo đơn                              | 20      | 65        | 65   | 0   | 0     |
| 13 Góp ý trên site web, phần tử và ảnh đính sau | 12      | 37        | 37   | 0   | 0     |
| Cộng                                            | 406     | 1377      | 1377 | 0   | 0     |

- Báo cáo: `qa-scripts/cf/ket-qua/2026-11-18_230142_y4-du-bo.md` (kèm `.json`, `.txt`).
- Chạy lượt hai trên cùng dữ liệu: 1376 đạt, trượt đúng `03 / Staff không còn đơn nào` (nhận 2 thay vì 0). Backend cũ cũng trượt đúng phép này khi chạy lại trên cùng database (`qa-scripts/cf/phu-thuoc.md` mục 6), nên đây là hành vi của bộ Postman, không phải lỗi của backend mới.
- Log của `wrangler dev` suốt các lượt chạy: không có dòng mức `error`, không có mã 5xx.
- Các gói của phiên Y phủ thư mục 03, 05, 07, 11, 12 và phần đường của mình trong các thư mục khác.

## Đã làm, theo gói

| Gói | Commit    | File                                                                                                                                                                                                                                                                         |
| --- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Y1  | `8f01469` | `routes/clientRoutes.js`, `routes/orderRoutes.js`, `controllers/clientController.js`, `controllers/orderController.js`, `services/clientService.js`, `services/orderService.js`, `validators/clientValidator.js`, `validators/orderValidator.js`                             |
| Y2  | `8187393` | `routes/activityRoutes.js`, `controllers/activityController.js`, `services/activityService.js`, `validators/activityValidator.js`                                                                                                                                            |
| Y3  | `5b2682f` | `middleware/guestMiddleware.js`, `routes/shareLinkRoutes.js`, `routes/publicRoutes.js`, `controllers/shareLinkController.js`, `services/shareLinkService.js`, `validators/shareLinkValidator.js`, và phần đầu của `services/roundService.js` (`toPublicRound`, `snapshotOf`) |
| Y4  | `1c1e178` | `routes/roundRoutes.js`, `routes/publicRoutes.js` (thêm `submit`, `approve`), `controllers/roundController.js`, `services/roundService.js`, `services/maintenanceService.js`, `validators/roundValidator.js`, `jobs/maintenanceJobs.js`                                      |

Không sửa file dùng chung nào, không sửa file của phiên X.

`guestMiddleware.js` xuất `resolveGuest` và `requireDevice` đúng như mục 12 mô tả; `c.get("guest")` là `{ link, deliverable, round, order, orderStatus, deviceHash, actor }`. `link` và `deliverable` mang đủ cột (kể cả `token`, `sdkKey`): nơi dùng không được trả nguyên ra API.

## Đã thử gì

Ngoài bộ Postman, có bốn kịch bản thử trực tiếp ở `qa-scripts/cf/` (không nằm trong repo):

| Kịch bản      | Kết quả     | Thử gì                                                                                                                                                                                                                                                                                                                                                                           |
| ------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `thu-y1.js`   | 85 phép đạt | Khách hàng và đơn hàng khi chưa có gói thành viên (thành viên thử chèn thẳng vào D1 của phiên Y): hình dạng JSON, lời báo, tìm không dấu, lọc tag, con trỏ, team và leader, quyền của leader và nhân viên, người bị gỡ mất quyền ngay, `member.orders` phản chiếu, bàn giao và mở lại, số dòng nhật ký từng loại, `tx_guard` trống. Chạy trước khi X1 có; giờ Postman 03 đã phủ. |
| `thu-y2.js`   | 16 phép đạt | Hoạt động của đơn trên dữ liệu Postman 03 để lại: phong bì, thứ tự, con trỏ, lọc theo nhóm và người làm, câu chữ đổi team.                                                                                                                                                                                                                                                       |
| `thu-y34.js`  | 47 phép đạt | Bấm cùng lúc: hai link đầu (cả hai 201, chỉ một vòng 1), hai khách gửi (một 200, một 409 "vòng đã khép"), hai lần mở vòng kế (một 201, một 409), hai khách duyệt (một 200, một 409). Nhật ký gửi ghi đúng số nháp. Lượt mở link đếm ngay. Đơn đã mở lại thì mở được vòng mới trên sản phẩm đã duyệt. Thu hồi link trả 404 cho khách. Câu chữ của hoạt động. `tx_guard` trống.    |
| `y-server.js` | công cụ     | Tắt và làm trống server thử của phiên Y (chỉ đụng `.wrangler/state-y` và tiến trình có `state-y` trong dòng lệnh).                                                                                                                                                                                                                                                               |

## Chưa thử

- **Việc dọn bản cũ của đơn đã bàn giao** (`purgeDeliveredVersions`, cron `41 */6 * * *`): chưa chạy lần nào. Lý do: trên máy dev chỉ gọi được cả nhóm cron 6 giờ, mà nhóm đó còn có việc dọn file tạm của gói X2 (`purgeStalePending`), việc ấy xóa file trên tài khoản Cloudinary thật. Phiên Y không tự kích. Cần phiên điều phối hoặc phiên X quyết cách thử (ví dụ tạm bỏ việc kia khỏi nhóm khi thử, và nhớ luật cũ: khi thử phải truyền `orderId`).
- **Báo trực tiếp**: `notifyFeedback` loại `submitted`, `approved`, `round`; `disconnectLink` khi thu hồi; `disconnectMember` khi gỡ khỏi team. Code có gọi, chưa nghe bằng WebSocket thật.
- **Ảnh trang khi vòng đã khóa với `force`**, và lưu nhiều ảnh trang một lần (xem điểm lệch 6). Postman 07 phủ các ca thường (lưu, giữ ảnh cũ bằng id, xóa bộ ảnh, trang không thuộc vòng).
- **Hai người lưu bộ ảnh trang cùng lúc** (guard `pages_rev`), **gỡ file cùng lúc với mở vòng** (guard `version` của sản phẩm), **đơn bị bàn giao giữa lúc đọc và lúc ghi**: guard đã đặt, chưa dựng được tình huống đụng nhau thật.
- **Giới hạn `guestWriteLimiter`** trên `submit`, `approve`: máy dev không áp.
- Mọi thứ trên Cloudflare thật: 10 ms CPU, D1 thật, trần 50 lời gọi ra ngoài.
- Các kịch bản cũ ở `qa-scripts/*.js` (`t1` đến `t9`, `be_kiem_*`): chưa chạy với backend mới; xem `qa-scripts/cf/kiem-ke-kich-ban.md`.

## Điểm lệch so với thiết kế và so với bản cũ

1. **Lượt mở link (`openByToken`) ghi ngay trong request, không dùng `runAfterResponse`.** Bảng ở mục 4 ghi "chạy bằng `runAfterResponse`". Bản cũ chờ câu ghi xong rồi mới trả lời, và `05 / Lượt mở link được đếm` đọc `openCount` ngay request kế tiếp; ghi sau response thì có thể đọc trước khi ghi. Lỗi ghi vẫn chỉ vào log, không chặn khách. Câu ghi đặt cả `updated_at` như bản cũ (mục 11 của kiến trúc), không tăng `version`. Tên khách giờ lấy chung trong lượt đọc ngữ cảnh, nên một lần khách mở link còn 3 lượt tới D1 (ngữ cảnh, các vòng, ghi lượt mở), thêm 1 lượt khi có ghim trên ảnh trang.
2. **Guard của team chặt hơn bảng** (#6, #8), xem điểm 1 ở mục "Xử lý kết quả soát thiết kế".
3. **`createShareLink` luôn guard "sản phẩm còn hoạt động"**, kể cả khi link không mở vòng (điểm 7 của bản soát).
4. **Tìm đơn theo tên khách** dùng JOIN với `clients.name_search` thay cho "tìm tối đa 200 khách rồi lọc đơn" của bản cũ. Kết quả như nhau khi dưới 200 khách khớp; trên 200 thì bản mới đủ hơn.
5. **Nhật ký `before` của `order.update`, `client.update`, `shareLink.update`** có cả khóa mang giá trị `null`. Bản cũ bỏ khóa mà document chưa từng có. Câu chữ ở "Hoạt động" chỉ đọc `after` nên không đổi.
6. **Đã hết lệch (23:20):** lưu ảnh trang giờ gọi kho 1 lần mỗi ảnh mới. `adoptPageShot` dùng `storage.adoptPending` do phiên X thêm ở `a667d76` (chuyển key và nhận luôn loại, cỡ, kích thước; kiểm loại và cỡ sau khi nhận, sai thì đưa key chính thức vào thùng rác). 30 trang là 30 lời gọi, dưới trần 50. Postman 07 qua với Cloudinary thật.
7. **`purgeDeliveredVersions`**: mỗi sản phẩm một lô có guard, có tăng `version` của sản phẩm khi sửa `files` (điểm 4 của bản soát; bản cũ không tăng). Không gọi kho, 5 đơn mỗi lượt (đúng mục 7).
8. **`refreshCurrentRound`** tính "file còn được giữ" bằng JavaScript từ một lượt đọc (file của các vòng khác, file có góp ý ghim), không gọi `isRetained` từng file. Guard đầu lô đúng như dòng #25.
9. **`setCurrentPages`** dùng `transact` với `retries: 0`: guard `status` và `pages_rev` sai thì trả 409 ngay và đưa ảnh vừa nhận vào thùng rác, không chạy lại (ảnh đã nhận gắn với lần đọc đó). Đúng ý bảng "ghi có điều kiện".
10. **Chi tiết đơn (`GET /orders/:id`) trả `client` gồm `id, name, contacts, source, tags, notes: null`**, không có `version`, `createdAt`, `updatedAt`. Đây là đúng thứ bản cũ trả (populate chỉ bốn trường rồi qua `toPublicClient`), giữ nguyên.
11. `roundValidator.js` import `ratio`, `size`, `pendingKeySchema` từ `feedbackValidator.js` của phiên X (đã `export`). `shareLinkValidator.js` và `roundValidator.js` tự khai `deliverableIdParams` để không phụ thuộc `deliverableValidator.js`.

Không có chỗ nào đổi đường dẫn, mã trạng thái hay lời báo so với bản cũ.

## Xử lý kết quả soát thiết kế (`docs/soat-thiet-ke.md`)

Sau khi sửa: cả bộ Postman chạy lại trên dữ liệu trống, 406 request, 1377 phép kiểm, 0 lỗi (`qa-scripts/cf/ket-qua/2026-11-18_231315_y-sau-soat.md`); `thu-y34.js` 47 phép đạt; `thu-diem1.js` 27 phép đạt; lint sạch.

| Điểm    | Đã làm gì                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 (cao) | `orderService.js`. Ba guard không nhãn trong lô của `setOrderMembers`, đặt sau `stale`: (a) `teamUnchangedGuard`: team trong `order_members` vẫn đúng là team `plan` đã đọc (cùng người, cùng `leader_position`); (b) `assignableGuard`: mọi người trong danh sách mới cùng tổ chức, `role <> 'admin'`, vai trò đúng như đã đọc, và không bị khóa trừ khi **lúc chạy lô** đang có dòng trong team của chính đơn đó (việc miễn tính bằng SQL, không theo danh sách đã đọc, và không áp cho admin); (c) `rolesUnchangedGuard`: vai trò của người bị gỡ vẫn như đã đọc, cho luật "chỉ quản trị viên gỡ được quản lý". Vì vai trò phải đúng như đã đọc và `plan` đã từ chối leader là viewer, không leader nào có thể là viewer lúc ghi. Câu xóa viết `member_id NOT IN (danh sách mới)`. `createOrder` dùng cùng `assignableGuard`, không miễn ai. Guard sai thì `transact` chạy lại `plan` và ra đúng lời cũ (ví dụ 400 "Quản trị viên thấy mọi đơn hàng nên không cần gán."). Không cần `updateMember` tăng `version` của đơn. |
| 1, thử  | `qa-scripts/cf/thu-diem1.js`: 12 lượt mỗi tình huống, bắn hai request cùng lúc lệch nhau 0 đến 5 ms theo cả hai chiều, rồi đọc thẳng D1. Tình huống A (hạ xuống viewer cùng lúc lưu team): sau cả 12 lượt không có viewer nào mang `leader_position`. Tình huống B (lên admin cùng lúc lưu team): sau cả 12 lượt không có admin nào trong `order_members`; 6 lượt lưu team nhận 400 đúng lời cũ, 6 lượt lưu team chạy trước. Phụ (leader gỡ người vừa lên quản lý): 6 lượt 403, 6 lượt gỡ trước khi đổi vai trò. Không chứng minh được có lượt nào rơi đúng vào khe giữa lúc đọc và lúc ghi của một lô; chỉ biết bất biến giữ ở mọi lượt.                                                                                                                                                                                                                                                                                                                                                                                     |
| 4       | `maintenanceService.js` viết lại: mỗi sản phẩm một lô, đầu lô guard đơn còn `delivered` và `versions_purged_at IS NULL`, guard `version` của sản phẩm như đã đọc, guard vòng mới nhất như đã đọc; rồi UPDATE `rounds.pages` của các vòng cũ, UPDATE `files` kèm `version + 1`, INSERT `storage_trash`. Mốc `versions_purged_at` đặt bằng `UPDATE ... WHERE status = 'delivered' AND versions_purged_at IS NULL`, và chỉ khi mọi sản phẩm của đơn đã qua; một guard sai thì cả đơn để lượt sau. **Vẫn chưa chạy thử** (lý do ở mục "Chưa thử"). Phiên X giữ `kien-truc.md`: cần thêm một dòng cho việc này vào bảng mục 4.                                                                                                                                                                                                                                                                                                                                                                                                     |
| 7       | `shareLinkService.js`: guard `status = 'active'` của sản phẩm luôn bật; khi link mở vòng 1 thêm guard `version` và `guardNot` "đã có vòng" không nhãn, `transact` tự chạy lại. Bỏ vòng lặp bắt lỗi trùng `(deliverable, number)`. Đã thử: hai link đầu tạo cùng lúc vẫn cả hai 201 và chỉ một vòng 1 (`thu-y34.js`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 8       | `roundService.js`: bỏ nhánh bắt `uniqueViolationOf` ở `openNextRound` (code chết), còn một lời gọi `transact`. Không còn chỗ nào "bắt rồi chạy lại hàm" trong file của phiên Y. Đã thử: hai lần mở vòng cùng lúc vẫn một 201, một 409 "Vòng hiện tại còn mở...".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 10      | Soát lại guard của phiên Y theo hai luật mới ở mục 3.2. Guard trên ngữ cảnh khách (`submitByGuest`, `approveByGuest`: vòng còn mở, có gì để gửi) đều có nhãn. Guard không nhãn nào cũng trùng với câu kiểm trong `plan`. `setCurrentPages` dùng `retries: 0` vì dữ liệu đọc nằm ngoài `plan`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 11      | `listAssignableMembers`: câu SQL có `ORDER BY id`, và phép sắp theo tên trong JavaScript phá hòa bằng id. Các danh sách khác của phiên Y đã sắp theo cột duy nhất (`id`, `number`) hoặc đã có cột phá hòa (`position, member_id`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 14      | Không phải sửa: `contactId`, `memberIds`, `leaderIds`, `clientId`, `pages[].id`, `pins[].feedbackId`, và id trong query của hoạt động đều qua `objectIdSchema`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 15      | Không phải sửa: lọc `clients.tags` bằng `json_each`; việc dọn bản cũ lọc "vòng có trang" bằng JavaScript sau khi đọc các vòng của đơn (cần mọi vòng để biết bộ file của vòng cuối), không có câu WHERE trên cột JSON.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 19      | `setCurrentPages`: guard thêm điều kiện "vẫn là vòng mới nhất của sản phẩm".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 20      | Không phải sửa: người liên hệ mới được sinh `_id` trong `createOrder`; không có API sửa người liên hệ nên `_id` cũ không bị đụng (`updateClient` chỉ đổi `name`, `source`, `tags`, `notes`); trang của vòng được sinh `id` và `capturedAt` trong `setCurrentPages`; người liên hệ tạo cùng đơn luôn là `isPrimary: true`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Về CPU (tin từ lần deploy thử): `listAssignableMembers` bỏ một truy vấn (dùng luôn team đã đọc cùng đơn); khách mở link bỏ một truy vấn (tên khách lấy chung). Còn một chỗ đọc lại có chủ ý: mọi thao tác ghi đơn (`createOrder`, `updateOrder`, `setOrderMembers`, `deliverOrder`, `reopenOrder`) đọc lại đơn kèm khách và team sau lô để trả đúng bản vừa lưu, tức 3 lượt tới D1 mỗi request (đọc, lô, đọc lại). Bỏ được lượt cuối bằng cách dựng kết quả từ `RETURNING` và dữ liệu đã đọc, nhưng chưa làm vì chưa có số đo cho thấy cần; chờ luật giữ CPU thấp ở `kien-truc.md` mục 11.

## Điều cần phiên X hoặc phiên điều phối

- (Đã xong) Điểm lệch 6: phiên X đã thêm `storage.adoptPending`, phiên Y đã dùng.
- Cách thử việc dọn bản cũ mà không kích việc dọn file tạm trên Cloudinary thật.
- Thêm một dòng cho `purgeDeliveredVersions` vào bảng mục 4 của `kien-truc.md` (điểm 4 của bản soát).
- Chưa có gì cần sửa ở file dùng chung.

## Cách chạy lại

Từ thư mục `Solaris CF`:

```
npx wrangler d1 migrations apply DB --local --persist-to .wrangler/state-y
npx wrangler dev --port 4002 --persist-to .wrangler/state-y --inspector-port 9232
```

Từ `qa-scripts/cf`:

```
node chay-postman.js --base-url http://127.0.0.1:4002/api/v1
node thu-y34.js
node y-server.js tat
node y-server.js lam-trong --khong-bat      tắt, xóa .wrangler/state-y, áp lại migration; sau đó tự bật server
```

Bẫy đã gặp:

- `y-server.js bat` (bật tách rời bằng Node) không lên được trên máy Windows này: wrangler dừng ở "Starting local server...". Bật bằng lệnh `npx wrangler dev ...` ở trên.
- Gọi `npx wrangler d1 execute ... --command "<SQL có dấu cách>"` qua `child_process` với `shell: true` làm vỡ câu SQL. Gọi thẳng `node node_modules/wrangler/bin/wrangler.js ...` thì không.
- `json_group_array(... ORDER BY ...)` và `INSERT ... SELECT ... FROM json_each(...) WHERE true ON CONFLICT ...` chạy được trên D1 cục bộ (dùng trong `orderService.js`).
- `localeCompare(b, "vi")` trong Worker sắp đúng thứ tự tiếng Việt (đã kiểm ở `thu-y1.js`).
