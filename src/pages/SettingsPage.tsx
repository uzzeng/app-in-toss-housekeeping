import { useEffect, useState } from 'react';
import { Notification } from '@apps-in-toss/web-framework';
import { Chip, ChipItem, ListRow, Switch } from '@toss/tds-mobile';
import { adaptive } from '@toss/tds-colors';
import { useCurrentUser } from '../hooks/useAnonymousKey';
import { ErrorBanner } from '../components/ErrorBanner';
import { toDisplayErrorMessage } from '../lib/errorMessage';
import { fetchSettings, settingsCache, updateSettings, type NotificationSettings } from '../lib/settings';

const REMINDER_DAYS_OPTIONS = [0, 1, 2, 3];
const REMINDER_DAYS_LABEL: Record<number, string> = { 0: '필요없음' };
const NOTIFICATION_TEMPLATE_CODE = 'housekeeping-daily';

// 토글을 켤 때만 알림 수신 동의를 요청한다. 이미 동의했으면 alreadyAgreed로 즉시 통과되고,
// 거부하면 토글이 켜지지 않도록 한다.
function requestNotificationAgreement(): Promise<boolean> {
  return new Promise((resolve) => {
    const cleanup = Notification.requestAgreement({
      options: { templateCode: NOTIFICATION_TEMPLATE_CODE },
      onEvent: (result) => {
        cleanup();
        resolve(result.type !== 'agreementRejected');
      },
      onError: () => {
        cleanup();
        resolve(false);
      },
    });
  });
}

function hmOf(time: string): string {
  return time.slice(0, 5);
}

function timeInputStyle(enabled: boolean): React.CSSProperties {
  return {
    display: 'block',
    fontSize: 16,
    fontWeight: 600,
    color: enabled ? adaptive.grey700 : adaptive.grey300,
    padding: '12px 16px',
    borderRadius: 12,
    border: 'none',
    background: adaptive.greyOpacity50,
    boxSizing: 'border-box',
    width: '66.6667%',
    margin: '0 auto',
    textAlign: 'center',
    opacity: enabled ? 1 : 0.5,
  };
}

interface ToggleSectionProps {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (checked: boolean) => void;
  time: string;
  onTimeChange: (value: string) => void;
}

function ToggleSection({ title, description, enabled, onToggle, time, onTimeChange }: ToggleSectionProps) {
  return (
    <>
      <ListRow
        role="switch"
        aria-checked={enabled}
        contents={
          <ListRow.Texts
            type="2RowTypeA"
            top={title}
            topProps={{ color: adaptive.grey700, fontWeight: 'bold' }}
            bottom={description}
            bottomProps={{ color: adaptive.grey600 }}
          />
        }
        right={<Switch checked={enabled} onChange={(_e, checked) => onToggle(checked)} />}
        verticalPadding="large"
        horizontalPadding="small"
      />
      <div style={{ padding: '0 16px 20px' }}>
        <input
          type="time"
          value={hmOf(time)}
          disabled={!enabled}
          onChange={(e) => onTimeChange(e.target.value)}
          style={timeInputStyle(enabled)}
        />
      </div>
    </>
  );
}

export function SettingsPage() {
  const currentUser = useCurrentUser();
  const anonKey = currentUser.status === 'success' ? currentUser.user.anonKey : null;
  const [settings, setSettings] = useState<NotificationSettings | null>(() =>
    anonKey ? settingsCache.get(anonKey) ?? null : null,
  );
  const [loading, setLoading] = useState(() => !(anonKey && settingsCache.has(anonKey)));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function load() {
    if (!anonKey) return;
    if (!settingsCache.has(anonKey)) setLoading(true);
    setErrorMessage(null);
    fetchSettings(anonKey)
      .then(setSettings)
      .catch((error: unknown) => setErrorMessage(toDisplayErrorMessage(error)))
      .finally(() => setLoading(false));
  }

  useEffect(load, [anonKey]);

  async function save(patch: Partial<NotificationSettings>) {
    if (!anonKey || !settings) return;
    const prev = settings;
    setSettings({ ...settings, ...patch });
    try {
      const updated = await updateSettings(anonKey, patch);
      setSettings(updated);
    } catch (error) {
      setErrorMessage(toDisplayErrorMessage(error));
      setSettings(prev);
      settingsCache.set(anonKey, prev);
    }
  }

  async function saveTimeToggle(field: 'notification_time_enabled' | 'reminder_time_enabled', checked: boolean) {
    if (!checked) {
      save({ [field]: false });
      return;
    }
    const agreed = await requestNotificationAgreement();
    if (agreed) save({ [field]: true });
  }

  if (currentUser.status === 'error') {
    return (
      <div style={{ padding: 16 }}>
        <p>사용자 식별에 실패했어요: {currentUser.reason}</p>
        <p style={{ fontSize: 12, color: '#888', wordBreak: 'break-all' }}>{currentUser.detail}</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 0 16px' }}>
      <div style={{ padding: '0 16px', marginBottom: 12 }}>
        <p style={{ margin: 0, fontSize: 22, fontWeight: 'bold', color: adaptive.grey900 }}>알림 설정</p>
      </div>

      {errorMessage && (
        <div style={{ padding: '0 16px' }}>
          <ErrorBanner message={errorMessage} onRetry={load} />
        </div>
      )}

      {loading || !settings ? (
        <p style={{ padding: '0 16px' }}>불러오는 중...</p>
      ) : (
        <>
          <ToggleSection
            title="알림 시간"
            description="해야 하는 집안일을 매일 알려드려요."
            enabled={settings.notification_time_enabled}
            onToggle={(checked) => saveTimeToggle('notification_time_enabled', checked)}
            time={settings.notification_time}
            onTimeChange={(value) => save({ notification_time: value })}
          />

          <ToggleSection
            title="리마인드 알림"
            description="하루 한 번 더, 리마인드 알림을 드려요."
            enabled={settings.reminder_time_enabled}
            onToggle={(checked) => saveTimeToggle('reminder_time_enabled', checked)}
            time={settings.reminder_time}
            onTimeChange={(value) => save({ reminder_time: value })}
          />

          <ListRow
            contents={
              <ListRow.Texts
                type="2RowTypeA"
                top="재알림 일수"
                topProps={{ color: adaptive.grey700, fontWeight: 'bold' }}
                bottom="최초 알림 이후 며칠 더 재알림을 보낼지 정해요."
                bottomProps={{ color: adaptive.grey600 }}
              />
            }
            verticalPadding="large"
            horizontalPadding="small"
          />
          <Chip kind="select" size="medium" margin="medium" wrap>
            {REMINDER_DAYS_OPTIONS.map((days) => (
              <ChipItem
                key={days}
                selected={settings.reminder_days === days}
                onClick={() => save({ reminder_days: days })}
              >
                {REMINDER_DAYS_LABEL[days] ?? `${days}일`}
              </ChipItem>
            ))}
          </Chip>
        </>
      )}
    </div>
  );
}
