/**
 * リアルタイム購読 (BK-08)
 *
 * 注文・呼び出し・提供状況の変化を BACK-system へ即時に届ける。
 * 見落としを防ぐという本システムの目的の中核。
 */
import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

/**
 * 対象テーブルに変化があったら onChange を呼ぶ。
 *
 * 短時間に複数の変更が来ても再取得は 1 回にまとめる。
 * 1回の注文で明細が複数行入るため、そのたびに読み直すと無駄が多い。
 */
export function useRealtimeRefresh(
  tables: string[],
  onChange: () => void,
  debounceMs = 300,
): void {
  const callbackRef = useRef(onChange);
  callbackRef.current = onChange;

  const key = tables.join(',');

  useEffect(() => {
    let timer: number | undefined;

    const schedule = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => callbackRef.current(), debounceMs);
    };

    const channel = supabase.channel(`bridge-refresh:${key}`);
    for (const table of key.split(',')) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        schedule,
      );
    }
    channel.subscribe();

    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [key, debounceMs]);
}

/**
 * 新しい呼び出しが届いたときの通知音。
 *
 * 音声ファイルを持たず Web Audio API で短い電子音を鳴らす。
 * 転送量を消費せず、無料枠を圧迫しないため。
 */
export function playAlert(): void {
  try {
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtor) return;

    const ctx = new AudioCtor();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    oscillator.frequency.setValueAtTime(1320, ctx.currentTime + 0.12);

    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.5);
    oscillator.onended = () => void ctx.close();
  } catch {
    // 音が鳴らせない環境でも画面表示は機能するため無視してよい
  }
}
