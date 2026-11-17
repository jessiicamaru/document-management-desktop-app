# Study Docs

App Windows để quản lý tài liệu học dạng `.md` và `.html`: Electron + React + TypeScript, build bằng electron-vite.

## Chạy

```bash
npm install
npm run dev        # chạy app ở chế độ dev (sửa code là tự reload)
npm run typecheck  # kiểm tra kiểu TypeScript
npm test           # unit test (Vitest)
npm run smoke      # build rồi tự bấm thử app trên sample-library/, fail nếu có lỗi; ảnh lưu vào scripts/
npm run dist       # đóng gói ra release/Study Docs Setup x.y.z.exe (chỉ trên máy, không phát hành)
npm run release    # đóng gói + phát hành lên GitHub Releases để các máy tự cập nhật
```

## Cập nhật app

App đã cài **tự cập nhật** từ [GitHub Releases](https://github.com/jessiicamaru/document-management-desktop-app/releases):

- Mỗi lần mở app (và cứ 4 giờ một lần), app kiểm tra bản mới rồi tải ngầm.
- Tải xong sẽ có thanh thông báo "Khởi động lại để cập nhật". Nếu bạn không bấm, bản mới sẽ được cài vào lần tắt app tiếp theo.
- Tài liệu, tag, trạng thái và settings đều được giữ nguyên.

Phát hành một bản mới:

```bash
npm version patch --no-git-tag-version   # 0.2.0 -> 0.2.1 (tính năng lớn thì dùng minor)
git commit -am "Release v0.2.1"
git push
npm run release
```

`npm run release` từ chối chạy nếu còn thay đổi chưa commit/push, hoặc nếu version đó đã được phát hành. Token GitHub lấy từ `gh auth token` (GitHub CLI), không lưu vào file nào.

Gỡ app: double-click `uninstall.bat`. Script tắt app, gỡ cài đặt, rồi hỏi có xoá settings trong `%APPDATA%\Study Docs` không. Thư mục tài liệu không bị đụng tới.

## Đọc code theo thứ tự này

| File | Làm gì |
|---|---|
| `src/shared/types.ts` | Kiểu dữ liệu dùng chung: DocEntry, DocMeta, DocsApi |
| `src/main/index.ts` | Process chính: cửa sổ, giao thức `doc://`, IPC, theo dõi thư mục, chặn link |
| `src/main/library.ts` | Quét thư mục (có cache), lấy tiêu đề + chữ để tìm kiếm từ md/html |
| `src/main/meta-store.ts` | `.docs-meta.json`: hàng đợi ghi, sao lưu file hỏng, giữ tag khi đổi tên file |
| `src/main/storage.ts` | Settings và danh sách "mở gần đây" trong `%APPDATA%\Study Docs` |
| `src/preload/index.ts` | Cầu nối duy nhất UI ↔ Node, lộ ra `window.api` |
| `src/renderer/src/App.tsx` | State chính: thư viện, bài đang mở, bộ lọc, tìm kiếm, thông báo lỗi |
| `src/renderer/src/components/Sidebar.tsx` | Cây thư mục, kết quả tìm kiếm, bộ lọc |
| `src/renderer/src/components/DocView.tsx` | Thanh tiêu đề (trạng thái, tag) + iframe cho HTML |
| `src/renderer/src/components/MarkdownView.tsx` | Render Markdown + Mermaid, xử lý link |
| `src/renderer/src/lib/docs.ts` | Tìm kiếm không dấu, cây thư mục, tiện ích |
| `tests/` | Unit test cho các hàm trên |

## Dữ liệu nằm ở đâu

- **File gốc không bao giờ bị sửa.**
- **Tag và trạng thái học** nằm trong `<thư mục tài liệu>/.docs-meta.json`, nên đi theo thư mục khi bạn đồng bộ bằng Git hay OneDrive.
  - Nếu file này bị hỏng (ví dụ do xung đột khi đồng bộ), app sao lưu nó thành `.docs-meta.corrupt-<thời gian>.json` và hiện cảnh báo, chứ không lặng lẽ xoá dữ liệu.
  - Đổi tên hoặc di chuyển file thì tag vẫn được giữ: app nhận ra file nhờ nội dung giống hệt, hoặc nhờ tên file giống (khi vừa di chuyển vừa sửa). Nếu có nhiều file cùng khớp thì app không đoán.
- **Settings và "mở gần đây"** nằm trong `%APPDATA%\Study Docs`, không ghi vào thư mục tài liệu.

## Bảo mật

- HTML mở trong iframe `sandbox`: chạy được CSS/JS riêng của bài nhưng không chạm được vào app hay ổ đĩa.
- Link trong bài: sang bài khác thì mở trong app; link web mở bằng trình duyệt; file khác (pdf, ảnh) mở bằng app mặc định. Riêng file chương trình/script (`.exe`, `.bat`, `.ps1`...) thì chỉ hiện trong Explorer, không bao giờ tự chạy.
