import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { User } from '@apps-in-toss/web-framework';

export interface CurrentUser {
  id: string;
  anonKey: string;
  notification_time: string;
  reminder_time: string;
  reminder_time_enabled: boolean;
  reminder_days: number;
}

export type CurrentUserState =
  | { status: 'loading' }
  | { status: 'success'; user: CurrentUser }
  | {
      status: 'error';
      reason: 'UNSUPPORTED_APP_VERSION' | 'UNKNOWN_ERROR' | 'VERIFY_FAILED';
      detail: string;
    };

async function verifyUser(anonKey: string): Promise<CurrentUser> {
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-user`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ anonKey }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`verify-user failed with status ${res.status}: ${body}`);
  }

  const { user } = await res.json();
  return { ...user, anonKey } as CurrentUser;
}

const CurrentUserContext = createContext<CurrentUserState | null>(null);

// 앱 진입 시 익명 식별키를 발급받고, 서버에서 검증/매핑해 현재 사용자 정보를 앱 전체에 공유한다.
// 페이지 이동마다 재검증하지 않도록 App 최상단에서 한 번만 실행한다.
export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CurrentUserState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    User.getAnonymousKey()
      .then(({ hash }) => verifyUser(hash))
      .then((user) => {
        if (!cancelled) setState({ status: 'success', user });
      })
      .catch((error: unknown) => {
        const reason =
          error === 'UNSUPPORTED_APP_VERSION' ? 'UNSUPPORTED_APP_VERSION' : 'VERIFY_FAILED';
        const detail = error instanceof Error ? error.message : String(error);
        if (!cancelled) setState({ status: 'error', reason, detail });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return <CurrentUserContext.Provider value={state}>{children}</CurrentUserContext.Provider>;
}

export function useCurrentUser(): CurrentUserState {
  const state = useContext(CurrentUserContext);
  if (!state) {
    throw new Error('useCurrentUser는 CurrentUserProvider 내부에서만 사용할 수 있어요.');
  }
  return state;
}
