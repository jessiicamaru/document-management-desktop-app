# Study Docs

App Windows để quản lý tài liệu học dạng `.md` và `.html`: Electron + React + TypeScript, build bằng electron-vite.

## Chạy

```bash
npm install
npm run dev      # chạy app ở chế độ dev (sửa code là tự reload)
npm run smoke    # build rồi tự bấm thử app trên sample-library/, lưu ảnh vào scripts/
npm run dist     # đóng gói ra release/Study Docs Setup x.y.z.exe
```

## Đọc code theo thứ tự này

| File | Làm gì |
|---|---|
| `src/shared/types.ts` | Kiểu dữ liệu dùng chung: DocEntry, DocMeta, DocsApi |
| `src/main/index.ts` | Process chính: cửa sổ, giao thức `doc://`, IPC, theo dõi thư mục |
| `src/main/library.ts` | Quét thư mục, lấy tiêu đề + chữ để tìm kiếm từ md/html |
| `src/main/storage.ts` | Lưu settings và `.docs-meta.json` (tag, trạng thái học) |
| `src/preload/index.ts` | Cầu nối duy nhất UI ↔ Node, lộ ra `window.api` |
| `src/renderer/src/App.tsx` | State chính: thư viện, bài đang mở, bộ lọc, tìm kiếm |
| `src/renderer/src/components/Sidebar.tsx` | Cây thư mục, kết quả tìm kiếm, bộ lọc |
| `src/renderer/src/components/DocView.tsx` | Thanh tiêu đề (trạng thái, tag) + iframe cho HTML |
| `src/renderer/src/components/MarkdownView.tsx` | Render Markdown + Mermaid |
| `src/renderer/src/lib/docs.ts` | Tìm kiếm không dấu, cây thư mục, tiện ích |

## Ghi chú

- File gốc không bao giờ bị sửa. Tag và trạng thái nằm trong `<thư mục tài liệu>/.docs-meta.json`.
- HTML mở trong iframe `sandbox`: chạy được CSS/JS riêng của bài nhưng không chạm được vào app hay ổ đĩa.
- Đổi tên/di chuyển file thì tag + trạng thái của file đó bị mất (đang lưu theo đường dẫn).
