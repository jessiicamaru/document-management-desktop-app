// Line endings. The code editor (CodeMirror) always works with "\n"; files made with
// Notepad or Word on Windows use "\r\n". Keep whatever the file used, so saving doesn't
// rewrite every line (and Git doesn't show the whole file as changed).

export type Eol = '\n' | '\r\n'

/** The line ending a text mostly uses. */
export function detectEol(text: string): Eol {
  const crlf = text.split('\r\n').length - 1
  const lf = text.split('\n').length - 1 - crlf
  return crlf > lf ? '\r\n' : '\n'
}

export const toLf = (text: string): string => text.replace(/\r\n/g, '\n')

export const fromLf = (text: string, eol: Eol): string => (eol === '\n' ? text : text.replace(/\n/g, '\r\n'))
