# Editor: plan

Turn the reader into a place to write notes too, like Obsidian or Typora, without giving up what the app promises today: **a file only changes where you changed it**.

Status: steps 1–4 are built. Next: tables, formulas and Mermaid in the Markdown editor, and a `/` menu.

Work top to bottom; each step ships on its own.

## Decisions

- **New notes are `.md` or `.html`**, chosen when creating one. The last choice is remembered and is the default in Settings.
- **Pasted images are embedded in the file** as `data:` URLs (base64), in Markdown and HTML alike, so one file is the whole note: it can be copied, mailed or exported to PDF without losing pictures.
  - Images are shrunk (at most 1600 px wide) and compressed (WebP) when pasted. A screenshot usually ends up at 100–300 KB.
  - Settings can switch to **saving images in an `assets/` folder** next to the note instead.
  - An image still over 2 MB after compression asks whether to save it as a separate file.
  - Raw folds the long base64 text into a small label (`[image 240 KB]`).
  - Search never indexes base64 text.
- **Markdown is written in a live-preview editor built on CodeMirror 6** (already used for Raw): the text you type is exactly what is saved. WYSIWYG editors (TipTap, Milkdown) were ruled out because they rewrite the whole Markdown file in their own style.
- **HTML is written on the page itself.** Changes inside one block (bold, italic, links, images) replace only that block, as inline editing does today. New paragraphs and list items (Enter) are inserted right after the block they were typed in; everything else in the page's structure stays as it is.
- **Word and PDF stay read-only** (highlights and notes only): saving a .docx back would lose formatting.

## Step 1: files in the sidebar

1. [x] **New note** (`Ctrl+N`, or right-click a folder): name + type (`.md` / `.html`). Markdown starts with `# Name`; HTML with a small page (charset, title, readable CSS). The note opens right away.
2. [x] **New folder** (right-click a folder).
3. [x] **Rename** a note or folder (right-click, or `F2`). Tags and notes follow (same content); the open note stays open.
4. [x] **Move** by dragging a note or folder onto a folder in the tree (inside one workspace folder).
5. [x] **Delete** to the Recycle Bin, after asking.
6. [x] Only inside workspace folders; names are checked (no `\ / : * ? " < > |`, no clash with an existing file).

## Step 2: pasting images

1. [x] Image helper: shrink + WebP, `data:` URL; GIFs kept as they are.
2. [x] Setting **Pasted images**: embed in the file / save in `assets/`.
3. [x] `Ctrl+V` of an image in Raw (Markdown: `![](…)`, HTML: `<img src="…" alt="">`).
4. [x] Raw folds `data:` URLs into a label.
5. [x] Search: `data:` URLs left out of the indexed text.

## Step 3: Markdown live preview

1. [x] **Write** mode for `.md`: a CodeMirror editor where headings, bold, italic, code, links, lists, quotes and rules look formatted; the line with the cursor shows its Markdown.
2. [x] Images (also embedded ones) and checkboxes `- [ ]` drawn in place; a click on a checkbox ticks it in the file.
3. [x] `Ctrl+B` / `Ctrl+I` / `Ctrl+K`, `Ctrl+S`, unsaved-changes guard, pasted images (step 2).
4. [ ] Later: tables, formulas, Mermaid, a `/` menu.

## Step 4: HTML with formatting

1. [x] `Ctrl+B` / `Ctrl+I` / `Ctrl+U`, links, pasted images inside a block; saved as that block's new inner HTML (sanitized).
2. [x] `Enter` in a paragraph, heading or list item starts a new paragraph (a new item in a list), written right after that block in the file; `Shift+Enter` is a line break. New headings, lists or tables: Raw for now.
