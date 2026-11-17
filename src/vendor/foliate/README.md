# foliate-js (vendored)

`mobi.js` reads MOBI / AZW3 (KF8) e-books. It is copied unchanged from
[johnfactotum/foliate-js](https://github.com/johnfactotum/foliate-js) (MIT, see `LICENSE`)
because the project is not published on npm by its author.

- Commit: `78914aef4466eb960965702401634c2cb348e9b1` (2026-05-01)
- SHA-256 of `mobi.js`: `016526df13a9f11ee6671a8c74346e1cf41fe6bdfe50165fdcbf744f015694f3`

`mobi.d.ts` holds the TypeScript types for the parts the app uses. To update, copy the new
`mobi.js` from upstream, read the diff, and update the commit and hash above.

How the app uses it:
- `src/renderer/src/lib/mobi-to-epub.ts` turns a book into an EPUB in memory, so the normal
  EPUB reader (page turning, highlights, Ctrl+F, reading position) works for it.
- `src/main/mobi-text.ts` reads the text for full-text search (in the search worker, which
  has no DOM: only the decompression part is used there).
