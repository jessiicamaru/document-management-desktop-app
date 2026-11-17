# Study Docs

App Windows để quản lý tài liệu học dạng `.md` và `.html`: Electron + React + TypeScript, build bằng electron-vite.

## Chạy

```bash
npm install
npm run dev        # chạy app ở chế độ dev (sửa code là tự reload)
npm run typecheck  # kiểm tra kiểu TypeScript
npm test           # unit test (Vitest)
npm run smoke      # build rồi tự bấm thử app trên bản sao của sample-library/, fail nếu có lỗi; ảnh lưu vào scripts/
npm run dist       # đóng gói ra release/Study Docs Setup x.y.z.exe (chỉ trên máy, không phát hành)
npm run release    # đóng gói + phát hành lên GitHub Releases để các máy tự cập nhật
npm run make-icon  # vẽ lại build/icon.png + icon.ico từ build/icon.svg
node scripts/make-sample-epub.mjs  # tạo lại sample-library/sach/Git cơ bản.epub
```

## Dùng app

| Phím / nút | Làm gì |
|---|---|
| Icon tờ giấy có dấu +, `Ctrl+O`, kéo thả file vào cửa sổ | Mở từng file ở bất kỳ đâu, giống mở file trong Word. File ngoài workspace hiện ở nhóm **File lẻ** dưới cây thư mục; di chuột vào rồi bấm × để bỏ khỏi danh sách. |
| Icon thư mục có dấu + | Thêm một hoặc nhiều thư mục vào workspace, ở ổ nào cũng được (C:, D:, USB...). Mỗi thư mục là một nhánh trên cây; di chuột vào tên thư mục rồi bấm × để bỏ nó khỏi workspace (file không bị xoá). |
| `Ctrl+K` | Tìm kiếm trong mọi thư mục (không cần gõ dấu) |
| `Ctrl+F` | Tìm trong bài đang mở (Markdown, HTML, cả cuốn EPUB), không cần gõ dấu. `Enter` / `Shift+Enter` sang kết quả sau / trước, `Esc` để đóng. |
| `Ctrl+E` hoặc icon đồng hồ | Danh sách bài mở gần đây |
| `↑` `↓` `Enter` `←` `→` trong danh sách bài | Chọn bài, mở bài, thu/mở thư mục. Cài đặt có tuỳ chọn xếp bài theo tên hoặc mới sửa trước. |
| `Alt+←` / `Alt+→`, nút ‹ ›, nút lùi/tiến trên chuột | Quay lại / tiến tới giữa các bài đã mở |
| **Mục lục** | Danh sách tiêu đề bên phải; bấm để nhảy tới, mục đang đọc được tô sáng. App nhớ vị trí đang đọc của từng bài. |
| **Bôi đen chữ** | Hiện thanh highlight: 4 màu hoặc **✎ Ghi chú**. Bấm vào chỗ đã highlight để sửa ghi chú, đổi màu, xoá. Tab **Ghi chú** ở bảng bên phải liệt kê mọi highlight của bài, và có ô **Ghi chú chung** cho cả bài. Ghi chú viết được Markdown (`**đậm**`, danh sách, `code`, link). Dùng được cho Markdown, HTML và EPUB. |
| **⋯ → Xuất PDF…** | Xuất bài .md / .html ra PDF (khổ A4, có số trang và bookmark theo tiêu đề, luôn nền sáng) |
| **⋯ → Xuất PDF kèm highlight và ghi chú…** | Như trên, nhưng in cả highlight theo màu, số chú thích ¹ ² ³ sau đoạn có ghi chú, và mục **Ghi chú** ở cuối file |
| File `.epub` | Đọc sách EPUB **từng trang** như sách thật: nút ‹ ›, phím ← → / PageUp PageDown, hoặc lăn chuột để lật trang; cửa sổ rộng thì hiện 2 trang. Thanh dưới cùng cho biết chương và % đã đọc. Mục lục theo chương, nhớ vị trí đọc, màu và cỡ chữ theo Cài đặt, tìm được cả chữ trong sách. Sách có DRM (mua trên Kindle, Google Play...) thì không mở được. |
| File `.mobi` / `.azw3` | Sách Kindle, đọc như EPUB (lật trang, mục lục, highlight, `Ctrl+F`, tìm kiếm). App chuyển sách sang EPUB trong bộ nhớ khi mở, không sửa file. Sách có DRM không mở được. |
| File `.pdf` | Mở trong app bằng pdf.js: cuộn từng trang, phóng to/thu nhỏ (nút góc dưới), mục lục theo bookmark của PDF, nhớ vị trí đọc. Highlight, ghi chú và `Ctrl+F` dùng được như bài Markdown; ô tìm kiếm tìm cả chữ bên trong PDF. PDF chỉ là ảnh scan (không có chữ) thì không tìm/highlight được. |
| `Ctrl+,` hoặc icon bánh răng | Cài đặt: chế độ Sáng/Tối, màu nhấn, cỡ chữ / kiểu chữ / độ rộng khi đọc Markdown, đổi tên / xoá tag trên mọi bài, dọn dữ liệu của file đã xoá |
| Markdown | Code block được tô màu theo ngôn ngữ (` ```js `, ` ```python `...), công thức `$...$` và `$$...$$` hiển thị bằng KaTeX, sơ đồ ` ```mermaid `. |
| **Sửa chữ** | Sửa chữ ngay trên bài (HTML và Markdown), kể cả chữ trong sơ đồ SVG của bài HTML (bấm vào chữ để hiện ô sửa). Chỉ thêm/xoá/sửa chữ: Enter, định dạng và kéo thả bị tắt. `Ctrl+S` lưu, `Esc` huỷ. |
| **Raw** | Mở mã nguồn bên cạnh bài để sửa bố cục, sơ đồ, thẻ HTML... Markdown được xem trước trực tiếp khi gõ; HTML cập nhật sau khi lưu (`Ctrl+S`). |

Khi sửa chữ, app chỉ thay đúng phần chữ bạn đổi trong file, phần còn lại giữ nguyên từng ký tự. Nếu không đảm bảo được điều đó (ví dụ thẻ HTML không có thẻ đóng, hoặc chữ bạn gõ sẽ bị Markdown hiểu thành định dạng) thì app không lưu và báo bạn dùng Raw. Nếu file bị sửa ở app khác trong lúc bạn đang sửa, app cũng không ghi đè.

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

`npm run release` từ chối chạy nếu còn thay đổi chưa commit/push, hoặc nếu version đó đã được phát hành. Việc tải lên dùng GitHub CLI (`gh`) đã đăng nhập sẵn, không lưu token vào file nào. Nếu lần chạy trước dừng giữa chừng, chạy lại sẽ tải tiếp phần còn thiếu.

Gỡ app: double-click `uninstall.bat`. Script tắt app, gỡ cài đặt, rồi hỏi có xoá settings trong `%APPDATA%\Study Docs` không. Thư mục tài liệu không bị đụng tới.

## Đọc code theo thứ tự này

| File | Làm gì |
|---|---|
| `src/shared/types.ts` | Kiểu dữ liệu dùng chung: DocEntry, DocMeta, DocsApi |
| `src/main/index.ts` | Process chính: cửa sổ, giao thức `doc://`, IPC, theo dõi thư mục, chặn link |
| `src/main/library.ts` | Quét thư mục (có cache), lấy tiêu đề + chữ để tìm kiếm từ md/html |
| `src/main/html-edit.ts` | Sửa chữ trên bài HTML: script chèn vào trang khi sửa, và ghi lại đúng chỗ trong file (parse5) |
| `src/main/view-helper.ts` | Script nhỏ chèn vào bài HTML khi đọc: mục lục, vị trí đọc, phím tắt |
| `src/main/updater.ts` | Tự cập nhật từ GitHub Releases |
| `src/main/workspace.ts` | Workspace nhiều thư mục: id của thư mục, chống thêm trùng/lồng nhau, tên hiển thị |
| `src/shared/anchor.ts` | Tìm lại và vẽ highlight (dùng chung cho Markdown, trang HTML và lúc xuất PDF) |
| `src/main/doc-store.ts` | File JSON theo từng bài của một thư mục (trong `%APPDATA%\Study Docs\data`): hàng đợi ghi, sao lưu file hỏng, đi theo file khi đổi tên |
| `src/main/notes-store.ts` | `notes.json`: highlight và ghi chú |
| `src/main/zip.ts` | Đọc từng file trong file zip/EPUB mà không phải tải cả file |
| `src/main/scan-cache.ts` | Nhớ tên + hash của file giữa các lần mở app, để thư mục lớn mở nhanh |
| `src/main/search-worker.ts` | Tìm kiếm chạy ở luồng riêng: đọc chữ của tài liệu ở chế độ nền, tìm không dấu |
| `src/main/search.ts` | Phía main process của luồng tìm kiếm |
| `src/shared/text.ts` | Bỏ dấu tiếng Việt, cắt đoạn trích quanh chỗ tìm thấy |
| `src/main/meta-store.ts` | `meta.json`: tag và trạng thái, đổi tên/xoá tag trên mọi bài |
| `src/main/storage.ts` | Settings và danh sách "mở gần đây" trong `%APPDATA%\Study Docs` |
| `src/preload/index.ts` | Cầu nối duy nhất UI ↔ Node, lộ ra `window.api` |
| `src/renderer/src/App.tsx` | State chính: thư viện, bài đang mở, bộ lọc, tìm kiếm, thông báo lỗi |
| `src/renderer/src/components/Sidebar.tsx` | Cây thư mục, kết quả tìm kiếm, bộ lọc |
| `src/renderer/src/components/DocView.tsx` | Thanh tiêu đề (trạng thái, tag), chế độ xem / sửa chữ / raw |
| `src/renderer/src/components/MarkdownView.tsx` | Render Markdown + Mermaid, xử lý link, sửa chữ trên bài |
| `src/renderer/src/components/HtmlView.tsx` | iframe cho bài HTML, nói chuyện với script sửa chữ |
| `src/renderer/src/components/Annotations.tsx` | Thanh highlight, ô ghi chú, danh sách ghi chú |
| `src/renderer/src/components/EpubView.tsx` | Đọc sách EPUB (epub.js) |
| `src/renderer/src/components/RawEditor.tsx` | Trình sửa mã nguồn (CodeMirror) |
| `src/renderer/src/components/reader.ts` | Giao diện chung của HtmlView/MarkdownView (mục lục, vị trí đọc, sửa chữ) |
| `src/renderer/src/PrintPage.tsx` | Trang dùng khi xuất Markdown ra PDF |
| `src/renderer/src/components/SettingsDialog.tsx` | Cửa sổ Cài đặt |
| `src/renderer/src/lib/md-edit.ts` | Ánh xạ chữ đã sửa về đúng vị trí trong file Markdown |
| `src/renderer/src/lib/docs.ts` | Tìm kiếm không dấu, cây thư mục, tiện ích |
| `tests/` | Unit test cho các hàm trên |

## Dữ liệu nằm ở đâu

- **File bài chỉ bị sửa khi bạn bấm Sửa chữ hoặc lưu trong Raw.** Khi đó app chỉ thay đúng phần bạn đổi, giữ nguyên kiểu xuống dòng của file, không sửa file không phải UTF-8, và từ chối ghi đè nếu file vừa bị sửa ở nơi khác. Đọc, highlight, gắn tag, xuất PDF không bao giờ đụng vào file bài.
- **Tag, trạng thái học, highlight và ghi chú** nằm trong dữ liệu của app, **không ghi gì vào thư mục tài liệu**. Giống cách Claude Code lưu mỗi project một thư mục, mỗi thư mục trong workspace (và mỗi thư mục có file lẻ) có một thư mục con:
  ```
  %APPDATA%\Study Docs\data\<mã thư mục>\
    info.json    đường dẫn thật của thư mục
    meta.json    tag, trạng thái
    notes.json   highlight, ghi chú
  ```
  - Mã là một chuỗi ngắn tính từ đường dẫn, nên bỏ thư mục khỏi workspace rồi thêm lại thì dữ liệu vẫn còn.
  - **Cài đặt → Sao lưu ra file…** xuất toàn bộ ra một file `.json`; **Khôi phục từ file…** gộp lại (không xoá gì). Dùng khi đổi máy hoặc cài lại Windows.
  - Nếu file dữ liệu bị hỏng, app sao lưu nó thành `meta.corrupt-<thời gian>.json` trước và hiện nút **Khôi phục…**: sửa bản sao lưu bằng tay rồi bấm **Gộp lại**, dữ liệu hiện tại không bị mất.
  - Đổi tên hoặc di chuyển file trong một thư mục của workspace thì tag vẫn được giữ: app nhận ra file nhờ nội dung giống hệt, hoặc nhờ tên file giống (khi vừa di chuyển vừa sửa). Nếu có nhiều file cùng khớp thì app không đoán.
- **File lẻ** (mở bằng `Ctrl+O`, kéo thả vào cửa sổ, hoặc bấm đúp từ Explorer): app chỉ nhớ đường dẫn, không chép file. File bị chuyển chỗ hay xoá thì hiện "không tìm thấy"; bấm × để bỏ khỏi danh sách (file và ghi chú của nó không bị xoá).
- **Highlight** không bao giờ ghi vào file bài. Mỗi highlight lưu đoạn chữ được chọn kèm vài chữ trước/sau, nên bài bị sửa vẫn tìm lại được chỗ; nếu đoạn đó bị xoá hẳn, ghi chú vẫn được giữ và đánh dấu "không còn tìm thấy". Với EPUB, vị trí được lưu chính xác bằng EPUB CFI.
- **Settings (kể cả giao diện) và "mở gần đây"** nằm trong `%APPDATA%\Study Docs`, không ghi vào thư mục tài liệu.
- **Bộ nhớ đệm cho tốc độ** cũng ở đó: `scan-cache.json` (tên các tài liệu) và thư mục `text-cache` (chữ đã đọc ra để tìm kiếm, lưu UTF-8 nên chỉ cỡ dung lượng chữ của mỗi cuốn sách). Xoá đi cũng không mất gì, app sẽ đọc lại. Chữ của file đã bị bỏ khỏi workspace được tự dọn.

## Bảo mật

- HTML mở trong iframe `sandbox`: chạy được CSS/JS riêng của bài nhưng không chạm được vào app hay ổ đĩa.
- Link trong bài: sang bài khác thì mở trong app; link web mở bằng trình duyệt. File khác chỉ được mở bằng app mặc định nếu thuộc danh sách an toàn (pdf, ảnh, txt, Office không macro, audio/video, xem `src/main/open-policy.ts`), và app hỏi trước khi mở nếu lệnh đến từ bên trong bài. Mọi loại khác (chương trình, script, `.py`, `.url`, file Office có macro...) chỉ hiện trong Explorer, không bao giờ tự chạy.
- Khi xuất PDF, trang không đọc được file nào khác và không mở được kết nối (CSP). File và thư mục ẩn (tên bắt đầu bằng dấu chấm) không bao giờ được trả cho trang nào; dữ liệu của app nằm ngoài thư mục tài liệu nên trang không với tới được.
