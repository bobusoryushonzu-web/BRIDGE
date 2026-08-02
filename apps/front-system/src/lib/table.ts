/**
 * 席情報の保持
 *
 * QR トークンは客が席を利用している間だけ必要なので localStorage に置く。
 * 別の席の QR を読み込んだら上書きされる。
 */
const TOKEN_KEY = 'bridge.qr_token';
const TABLE_NUMBER_KEY = 'bridge.table_number';

export function saveTable(qrToken: string, tableNumber: string): void {
  localStorage.setItem(TOKEN_KEY, qrToken);
  localStorage.setItem(TABLE_NUMBER_KEY, tableNumber);
}

export function getQrToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getTableNumber(): string | null {
  return localStorage.getItem(TABLE_NUMBER_KEY);
}

export function clearTable(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TABLE_NUMBER_KEY);
}
