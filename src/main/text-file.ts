import { t } from '../shared/i18n'
// Reading a text file that is about to be edited.
//
// Edits are written back as UTF-8. A file in another encoding (e.g. Windows-1258) read as
// UTF-8 would have its non-ASCII characters replaced by "�" on save, all through the file.
// So editing is refused for anything that isn't valid UTF-8 (reading it is still fine).

export class NotUtf8Error extends Error {
  constructor() {
    super(t('File này không phải mã hoá UTF-8, nên không sửa được trong app (sẽ làm hỏng chữ). Hãy chuyển file sang UTF-8 bằng một trình soạn thảo khác, hoặc chỉ xem.'))
  }
}

/** Decodes UTF-8, keeping a byte-order mark if there is one; throws NotUtf8Error otherwise. */
export function decodeUtf8Strict(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    throw new NotUtf8Error()
  }
}
