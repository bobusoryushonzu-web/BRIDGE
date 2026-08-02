/**
 * 画面表示用のラベルと書式
 * FRONT-system と BACK-system で表記を揃えるため共有する。
 */
import type {
  CallType,
  ItemStatus,
  ServeTiming,
  SessionStatus,
  StaffRole,
} from './types';

export const SERVE_TIMING_LABEL: Record<ServeTiming, string> = {
  during: '食中',
  after: '食後',
};

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  pending: '未提供',
  served: '提供済み',
};

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  active: '利用中',
  checkout_requested: '会計依頼あり',
  closed: '会計済み',
};

export const CALL_TYPE_LABEL: Record<CallType, string> = {
  bell: '呼び出し',
  serve_after: '食後の商品をお出しする',
  checkout: '会計',
};

/** 呼び出し種別ごとの絵文字。店員が一覧で瞬時に見分けるため */
export const CALL_TYPE_ICON: Record<CallType, string> = {
  bell: '🔔',
  serve_after: '🍰',
  checkout: '💰',
};

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  admin: '管理者',
  staff: 'スタッフ',
};

/** 金額を「1,480円」の形式にする */
export function formatYen(amount: number): string {
  return `${amount.toLocaleString('ja-JP')}円`;
}

/** 時刻を「14:05」の形式にする */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 指定時刻からの経過を「12分前」の形式にする。見落とし防止の目印に使う */
export function formatElapsed(iso: string, now: number = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'たった今';
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  return `${hours}時間${minutes % 60}分前`;
}
