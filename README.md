# Study Docs

A Windows app for reading and organising study documents: Markdown, HTML, PDF, Word, plain text, EPUB and Kindle books, and pictures. Tags, study status, highlights and notes for every document; full-text search that ignores Vietnamese accents. The interface is in English or Vietnamese.

Built with Electron + React + TypeScript (electron-vite).

## Run

```bash
npm install
npm run dev        # run the app in development mode (reloads when you change code)
npm run typecheck  # TypeScript type check
npm test           # unit tests (Vitest)
npm run smoke      # build, then click through the app on a copy of sample-library/; fails on any problem; screenshots go to scripts/
npm run dist       # package release/Study Docs Setup x.y.z.exe (local only, not published)
npm run release    # package and publish to GitHub Releases, so installed apps update themselves
npm run make-icon  # redraw build/icon.png + icon.ico from build/icon.svg
node scripts/make-sample-epub.mjs  # rebuild sample-library/sach/Git cơ bản.epub
node scripts/make-sample-mobi.mjs  # rebuild sample-library/sach/Docker nhanh.mobi
node scripts/make-sample-docx.mjs  # rebuild sample-library/frontend/CSS Flexbox.docx
```

## Using the app

| Key / button | What it does |
|---|---|
| Page icon with +, `Ctrl+O`, or drop files on the window | Open single files from anywhere, like opening a file in Word. Files outside the workspace are listed under **Single files** below the folder tree; hover and click × to remove one from the list. |
| Folder icon with + | Add one or more folders to the workspace, on any drive (C:, D:, USB…). Each folder is a branch of the tree; hover its name and click × to remove it from the workspace (no files are deleted). |
| `Ctrl+K` | Search every folder (accents are optional: "su kien" finds "sự kiện") |
| `Ctrl+F` | Find in the open document (Markdown, HTML, PDF, Word, text, a whole EPUB/Kindle book), accents optional. `Enter` / `Shift+Enter` for next / previous, `Esc` to close. |
| `Ctrl+E` or the clock icon | Recently opened documents |
| `↑` `↓` `Enter` `←` `→` in the document list | Move, open, fold/unfold folders. Settings can order documents by name or by last change. |
| `Alt+←` / `Alt+→`, the ‹ › buttons, mouse back/forward buttons | Go back / forward between documents |
| **Outline** | Headings on the right; click to jump, the section being read is highlighted. The reading position of every document is remembered. |
| **Select text** | Shows the highlight bar: 4 colours or **✎ Note**. Click a highlight to edit its note, change its colour or delete it. The **Notes** tab on the right lists every highlight, plus a **Document note** for the whole document. Notes are Markdown (`**bold**`, lists, `code`, links). |
| **⋯ → Export PDF…** | Export a .md / .html document to PDF (A4, page numbers, bookmarks from the headings, always light) |
| **⋯ → Export PDF with highlights and notes…** | The same, with highlights in their colours, note numbers ¹ ² ³ after the passages, and a **Notes** section at the end |
| `.epub` files | Read books **page by page**: ‹ › buttons, ← → / PageUp PageDown, or the mouse wheel. One page, or two side by side on a wide window (Settings → Reading). The bottom bar shows the chapter and % read. Books with DRM (bought on Kindle, Google Play…) can't be opened. |
| `.mobi` / `.azw3` files | Kindle books, read like EPUB (pages, outline, highlights, `Ctrl+F`, search). The book is turned into an EPUB in memory when opened; the file is not changed. Books with DRM can't be opened. |
| `.pdf` files | Shown with pdf.js: scroll through the pages, zoom (buttons at the bottom right), outline from the PDF's bookmarks, reading position remembered. Highlights, notes and `Ctrl+F` work as in Markdown; search finds text inside PDFs. Scanned PDFs (pictures without text) can't be searched or highlighted. |
| `.docx` / `.txt` / pictures | Word documents are shown as a page: headings in the outline, bold/italic, lists, tables, images. Text files are shown as they are (UTF-8, UTF-16 or Windows-1258). Highlights, notes, `Ctrl+F` and search work; these files are never changed. Pictures (.png, .jpg, .svg…) can be zoomed with the buttons or `Ctrl` + mouse wheel; Settings can hide them from the list. |
| Markdown | Code blocks coloured by language (` ```js `, ` ```python `…), formulas `$...$` and `$$...$$` drawn with KaTeX, ` ```mermaid ` diagrams. |
| **Edit text** | Edit text right on the page (HTML and Markdown), including text in SVG diagrams of HTML pages (click it to get a text box). Only text: Enter, formatting and drag & drop are off. `Ctrl+S` saves, `Esc` cancels. |
| **Raw** | Open the source next to the document to change layout, diagrams, HTML tags… Markdown previews as you type; HTML updates when you save (`Ctrl+S`). |
| `Ctrl+,` or the gear icon | Settings, in tabs: **Appearance** (language, light/dark, accent colour), **Reading** (Markdown text size, font and width; one or two book pages), **Library** (folders, sidebar order, pictures), **Data** (backup and restore, tags across the workspace, clean-up, recovery), **Updates**. |

When editing text, the app replaces exactly the text you changed in the file and keeps every other character. If it can't be sure of that (an HTML tag without its closing tag, or text that Markdown would read as formatting), it doesn't save and tells you to use Raw. If the file is changed by another app while you edit, it isn't overwritten either.

## Updates

The installed app **updates itself** from [GitHub Releases](https://github.com/jessiicamaru/study-docs/releases):

- Every time it starts (and every 4 hours), it checks for a new version and downloads it in the background.
- When it's ready, a bar says "Restart to update". If you don't click it, the new version is installed the next time you close the app.
- Documents, tags, status, notes and settings are kept.

Publishing a new version:

```bash
npm version patch --no-git-tag-version   # 0.9.1 -> 0.9.2 (use minor for bigger features)
git commit -am "Release v0.9.2"
git push
npm run release
```

`npm run release` refuses to run with uncommitted or unpushed changes, or if that version was already published. It runs the type check and unit tests first. Uploading uses the GitHub CLI (`gh`), already logged in; no token is stored in any file. If an earlier run stopped half-way, running it again uploads what is missing.

Uninstalling: double-click `uninstall.bat`. It closes the app, uninstalls it, then asks whether to delete the app's data in `%APPDATA%\Study Docs` (settings, tags, notes; back them up first in Settings → Data). Your document folders are never touched.

## Where things are stored

- **Documents are only changed when you use Edit text or save in Raw.** Then only the part you changed is replaced, the file's line endings are kept, files that are not UTF-8 are never edited, and a file changed elsewhere in the meantime is not overwritten. Reading, highlighting, tagging and exporting never touch the documents.
- **Tags, study status, highlights and notes** are kept in the app's own data, **never in your documents' folders**. Like Claude Code keeps one folder per project, every workspace folder (and every folder of single files) gets a sub-folder:
  ```
  %APPDATA%\Study Docs\data\<folder key>\
    info.json    the real path of the folder
    meta.json    tags, status
    notes.json   highlights, notes
  ```
  - The key is a short hash of the path, so removing a folder from the workspace and adding it again keeps its data.
  - **Settings → Data → Back up to a file…** saves everything to one `.json` file; **Restore from a file…** merges it back (nothing is deleted). Use it when moving to another PC or reinstalling Windows.
  - If a data file is broken, the app first copies it to `meta.corrupt-<time>.json` and shows **Recover…**: fix the backup by hand, then click **Merge**; the current data is kept.
  - Renaming or moving a file inside a workspace folder keeps its tags: the file is recognised by identical content, or by the same file name (moved and edited). If several files match, the app doesn't guess.
- **Single files** (`Ctrl+O`, drag and drop, double-click in Explorer): only the path is remembered, the file isn't copied. A moved or deleted file shows "not found"; click × to remove it from the list (the file and its notes are kept).
- **Highlights** are never written into the document. Each one keeps the selected text with a few words before and after, so it is found again after the document is edited; if the passage is gone, the note is kept and marked "no longer found". In EPUB books the exact position is kept as an EPUB CFI; in PDFs, the page.
- **Settings and "recently opened"** are in `%APPDATA%\Study Docs`.
- **Caches for speed** are there too: `scan-cache.json` (document names) and `text-cache` (text read out for search, stored as UTF-8). Deleting them loses nothing; the app reads the files again. Text of files that left the workspace is cleaned up automatically.

## Security

- HTML documents open in a `sandbox` iframe: their own CSS/JS runs, but they can't reach the app or the disk.
- Links in documents: other documents open in the app; web links open in the browser. Other files are only opened with their default app if they are on the safe list (pdf, pictures, csv, Office without macros, audio/video; see `src/main/open-policy.ts`), and the app asks first when the request comes from inside a document. Anything else (programs, scripts, `.py`, `.url`, Office files with macros…) is only shown in Explorer, never run.
- When exporting to PDF, the page can't read other files or open connections (CSP). Hidden files and folders (names starting with a dot) are never served to a page, and the app's data is outside the documents' folders, out of reach of pages.
- SVG pictures are shown with `<img>`, where their scripts never run. Kindle books are decoded by a copy of foliate-js's `mobi.js` taken unchanged from its author's repository (see `src/vendor/foliate/README.md`).

## Reading the code

| File | What it does |
|---|---|
| `src/shared/types.ts` | Shared data types: DocEntry, DocMeta, Annotation, DocsApi |
| `src/shared/i18n.ts`, `src/shared/locales/en.ts` | Interface language: `t('Vietnamese text')`, English translations keyed by that text |
| `src/main/index.ts` | Main process: window, `doc://` protocol, IPC, folder watching, single files, backup, link handling |
| `src/main/library.ts` | Folder scanning (cached), titles and searchable text of every document type |
| `src/main/doc-store.ts` | One JSON file per workspace folder (in `%APPDATA%\Study Docs\data`): write queue, backup of broken files, following renamed files |
| `src/main/meta-store.ts` | `meta.json`: tags and status, renaming/removing a tag everywhere |
| `src/main/notes-store.ts` | `notes.json`: highlights, notes, document notes |
| `src/main/storage.ts` | Settings and "recently opened" in `%APPDATA%\Study Docs` |
| `src/main/workspace.ts` | Multi-folder workspace: folder keys, no duplicate/nested folders, display names |
| `src/main/search-worker.ts`, `search.ts` | Full-text search in a background thread (accent-insensitive), and its main-process side |
| `src/main/text-cache.ts` | Compact on-disk text cache for search snippets |
| `src/main/pdf-text.ts`, `mobi-text.ts` | Text of PDFs (pdf.js) and Kindle books for search, in the search thread |
| `src/main/zip.ts` | Reads single files out of a zip/EPUB/docx without loading all of it |
| `src/main/scan-cache.ts` | Remembers names + hashes between runs, so big folders open fast |
| `src/main/html-edit.ts` | Editing HTML text: script added to the page while editing, and writing back in place (parse5) |
| `src/main/view-helper.ts` | Small script added to HTML pages while reading: outline, reading position, shortcuts, find |
| `src/main/open-policy.ts` | Which files may be opened with their default app |
| `src/main/updater.ts` | Self-update from GitHub Releases |
| `src/shared/anchor.ts` | Finding and drawing highlights and find results (Markdown, HTML pages, PDF export) |
| `src/shared/text.ts` | Removing Vietnamese accents, snippets, text decoding |
| `src/preload/index.ts` | The only bridge between the window and Node, exposed as `window.api` |
| `src/renderer/src/App.tsx` | Main state: library, open document, filters, search, shortcuts, drag & drop |
| `src/renderer/src/components/Sidebar.tsx` | Folder tree, single files, search results, filters, arrow keys |
| `src/renderer/src/components/DocView.tsx` | Header (status, tags), view / edit text / raw modes, outline and notes panel |
| `src/renderer/src/components/reader.ts` | What every document view provides (outline, position, highlights, find) |
| `src/renderer/src/components/MarkdownView.tsx` | Markdown + Mermaid + code colours + KaTeX, links, editing text |
| `src/renderer/src/components/HtmlView.tsx` | Iframe for HTML documents, talks to the page scripts |
| `src/renderer/src/components/PdfView.tsx` | PDFs with pdf.js: pages drawn on demand, text layer, zoom |
| `src/renderer/src/components/EpubView.tsx` | EPUB (and converted Kindle) books with epub.js |
| `src/renderer/src/components/ArticleView.tsx` | Word (mammoth) and plain text documents |
| `src/renderer/src/components/ImageView.tsx` | Pictures with zoom |
| `src/renderer/src/components/Annotations.tsx` | Highlight bar, note editor, notes list |
| `src/renderer/src/components/FindBar.tsx` | Ctrl+F bar |
| `src/renderer/src/components/RawEditor.tsx` | Source editor (CodeMirror) |
| `src/renderer/src/components/SettingsDialog.tsx` | Settings window (tabs) |
| `src/renderer/src/lib/md-edit.ts` | Maps edited text back to its place in the Markdown file |
| `src/renderer/src/lib/mobi-to-epub.ts` | Kindle book → EPUB in memory |
| `src/renderer/src/lib/epub-locations.ts` | "% read" positions of a book, computed without freezing the window |
| `src/renderer/src/PrintPage.tsx` | Page used to export Markdown to PDF |
| `tests/` | Unit tests |
