/**
 * 店員の認証状態 (BK-13)
 *
 * Supabase Auth でログインしただけでは権限は付かない。
 * staff_users に登録されていることが BACK-system を使える条件。
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import type { StaffUser } from '@bridge/shared';
import { supabase } from './supabase';

interface AuthContextValue {
  loading: boolean;
  session: Session | null;
  staff: StaffUser | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * staff_users の登録状況を再確認する。
   * 管理者がログイン後に staff_users へ登録した場合、開きっぱなしのタブは
   * それを知らないため、手動で再チェックできるようにする。
   */
  recheckStaff: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchStaff(userId: string): Promise<StaffUser | null> {
  const { data } = await supabase
    .from('staff_users')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  return (data as StaffUser | null) ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [staff, setStaff] = useState<StaffUser | null>(null);

  useEffect(() => {
    let active = true;

    async function loadStaff(current: Session | null) {
      if (!current) {
        if (active) setStaff(null);
        return;
      }
      const next = await fetchStaff(current.user.id);
      if (active) setStaff(next);
    }

    void supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await loadStaff(data.session);
      if (active) setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      void loadStaff(next);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      session,
      staff,
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          throw new Error('メールアドレスまたはパスワードが違います');
        }
      },
      signOut: async () => {
        await supabase.auth.signOut();
      },
      recheckStaff: async () => {
        if (!session) return;
        setStaff(await fetchStaff(session.user.id));
      },
    }),
    [loading, session, staff],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth は AuthProvider の内側でのみ使用できます');
  }
  return context;
}
