import { useEffect, useState } from 'react';
import { User } from '@apps-in-toss/web-framework';

export interface CurrentUser {
  id: string;
  notification_time: string;
  reminder_time: string;
  reminder_time_enabled: boolean;
  reminder_days: number;
}

type CurrentUserState =
  | { status: 'loading' }
  | { status: 'success'; user: CurrentUser }
  | {
      status: 'error';
      reason: 'UNSUPPORTED_APP_VERSION' | 'UNKNOWN_ERROR' | 'VERIFY_FAILED';
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
    throw new Error(`verify-user failed with status ${res.status}`);
  }

  const { user } = await res.json();
  return user as CurrentUser;
}

// 앱 진입 시 익명 식별키를 발급받고, 서버에서 검증/매핑해 현재 사용자 정보를 반환한다.
export function useCurrentUser(): CurrentUserState {
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
        if (!cancelled) setState({ status: 'error', reason });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
