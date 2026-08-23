import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Asset, Button, Stepper } from '@toss/tds-mobile';
import { adaptive } from '@toss/tds-colors';
import { useCurrentUser } from '../hooks/useAnonymousKey';
import { fetchChores } from '../lib/chores';

const { StepperRow } = Stepper;

// 앱 최초 진입(스플래시 직후) 시점에만 판단해 여기로 리다이렉트된다. 이미 앱을 쓰다가
// 나중에 집안일을 전부 지워 0개가 되어도, 그건 이 화면을 다시 거치지 않는다.
// onStart: 최초 진입 판단(App.tsx의 entry state)을 완료 처리해, "/"로 돌아갔을 때
// 다시 이 화면으로 튕기지 않도록 한다.
export function OnboardingPage({ onStart }: { onStart: () => void }) {
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  const anonKey = currentUser.status === 'success' ? currentUser.user.anonKey : null;

  useEffect(() => {
    if (!anonKey) return;
    fetchChores(anonKey)
      .then((chores) => {
        if (chores.length > 0) {
          onStart();
          navigate('/', { replace: true });
          return;
        }
        setChecking(false);
      })
      .catch(() => setChecking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anonKey, navigate]);

  function handleStart() {
    onStart();
    navigate('/', { replace: true });
  }

  if (currentUser.status === 'error' || checking) {
    return null;
  }

  return (
    <div style={{ padding: '20px 16px calc(96px + env(safe-area-inset-bottom))', boxSizing: 'border-box' }}>
      <p style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 'bold', color: adaptive.grey900 }}>
        언제 청소했더라?
        <br />
        이제 고민하지 마세요
      </p>
      <p style={{ margin: 0, fontSize: 15, color: adaptive.grey600 }}>집안일 주기를 기억하고, 때가 되면 알려드려요</p>

      <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
        <Asset.Image
          frameShape={{ width: 200 }}
          backgroundColor="transparent"
          src="/onboarding-character.jpeg"
          aria-hidden={true}
          style={{ aspectRatio: '1/1', objectFit: 'contain' }}
        />
      </div>

      <Stepper style={{ margin: '0 -16px' }}>
        <StepperRow
          left={
            <StepperRow.AssetFrame
              shape={Asset.frameShape.CleanW30}
              content={<Asset.Icon name="icon-line-three-dots-mono-02" color={adaptive.grey700} aria-hidden={true} />}
            />
          }
          center={<StepperRow.Texts type="A" title="집안일 등록" description="할 일과 반복 주기를 정해보세요" />}
        />
        <StepperRow
          left={
            <StepperRow.AssetFrame
              shape={Asset.frameShape.CleanW30}
              content={<Asset.Icon name="icon-alarm-mono" color={adaptive.grey700} aria-hidden={true} />}
            />
          }
          center={<StepperRow.Texts type="A" title="알림으로 리마인드" description="정해둔 시간에 할 일을 알려드려요" />}
        />
        <StepperRow
          left={
            <StepperRow.AssetFrame
              shape={Asset.frameShape.CleanW30}
              content={<Asset.Icon name="icon-calendar-check-mono" color={adaptive.grey700} aria-hidden={true} />}
            />
          }
          center={<StepperRow.Texts type="A" title="한눈에 보는 캘린더" description="언제 뭘 했는지 기록이 자동으로 쌓여요" />}
          hideLine={true}
        />
      </Stepper>

      <div
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          padding: '16px 16px calc(16px + env(safe-area-inset-bottom))',
          background: '#fff',
        }}
      >
        <Button display="block" onClick={handleStart}>
          시작하기
        </Button>
      </div>
    </div>
  );
}
