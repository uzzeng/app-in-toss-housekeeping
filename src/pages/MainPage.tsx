import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Asset, IconButton, List, ListRow, Post, useDialog } from '@toss/tds-mobile';
import { adaptive } from '@toss/tds-colors';
import { useCurrentUser } from '../hooks/useAnonymousKey';
import { ErrorBanner } from '../components/ErrorBanner';
import { toDisplayErrorMessage } from '../lib/errorMessage';
import {
  fetchOverdueCount,
  fetchTodayOccurrences,
  fetchWeekOccurrences,
  overdueCountCache,
  setOccurrenceCompleted,
  todayOccurrencesCache,
  weekOccurrencesCache,
  type Occurrence,
} from '../lib/occurrences';

function formatDateLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

export function MainPage() {
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const { openAlert } = useDialog();
  const anonKey = currentUser.status === 'success' ? currentUser.user.anonKey : null;
  const [today, setToday] = useState<Occurrence[]>(() => (anonKey ? todayOccurrencesCache.get(anonKey) ?? [] : []));
  const [week, setWeek] = useState<Occurrence[]>(() => (anonKey ? weekOccurrencesCache.get(anonKey) ?? [] : []));
  const [overdueCount, setOverdueCount] = useState(() => (anonKey ? overdueCountCache.get(anonKey) ?? 0 : 0));
  const [loading, setLoading] = useState(() => !(anonKey && todayOccurrencesCache.has(anonKey)));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function load() {
    if (!anonKey) return;
    const hasCache = todayOccurrencesCache.has(anonKey);
    if (!hasCache) setLoading(true);
    setErrorMessage(null);
    Promise.all([fetchTodayOccurrences(anonKey), fetchWeekOccurrences(anonKey), fetchOverdueCount(anonKey)])
      .then(([todayList, weekList, overdue]) => {
        setToday(todayList);
        setWeek(weekList);
        setOverdueCount(overdue);
      })
      .catch((error: unknown) => setErrorMessage(toDisplayErrorMessage(error)))
      .finally(() => setLoading(false));
  }

  useEffect(load, [anonKey]);

  function applyStatus(list: Occurrence[], id: string, status: Occurrence['status']): Occurrence[] {
    return list.map((o) => (o.id === id ? { ...o, status } : o));
  }

  function handleManualClick() {
    openAlert({
      title: '이 기록은 수정할 수 없어요',
      description: '수기 입력한 항목은 캘린더에서 삭제해 주세요.',
      alertButton: '확인',
    });
  }

  async function handleToggle(occurrence: Occurrence) {
    if (!anonKey) return;
    const nextCompleted = occurrence.status !== 'done';
    const nextStatus: Occurrence['status'] = nextCompleted ? 'done' : 'pending';

    // 목록에서 제거/추가하지 않고, 같은 항목의 status만 낙관적으로 갱신
    setToday((prev) => {
      const next = applyStatus(prev, occurrence.id, nextStatus);
      todayOccurrencesCache.set(anonKey, next);
      return next;
    });
    try {
      await setOccurrenceCompleted(anonKey, occurrence.id, nextCompleted);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      // 실패 시 원복
      setToday((prev) => {
        const next = applyStatus(prev, occurrence.id, occurrence.status);
        todayOccurrencesCache.set(anonKey, next);
        return next;
      });
    }
  }

  if (currentUser.status === 'error') {
    return (
      <div style={{ padding: 16 }}>
        <p>사용자 식별에 실패했어요: {currentUser.reason}</p>
        <p style={{ fontSize: 12, color: '#888', wordBreak: 'break-all' }}>{currentUser.detail}</p>
      </div>
    );
  }

  const remaining = today.filter((o) => o.status !== 'done').length;

  return (
    <div style={{ padding: '12px 16px 16px' }}>
      {errorMessage && <ErrorBanner message={errorMessage} onRetry={load} />}

      {loading ? (
        <p>불러오는 중...</p>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 'bold', color: adaptive.grey900 }}>Housekeeping!</p>
            <IconButton
              aria-label="알림 설정"
              variant="clear"
              name="icon-alarm-mono"
              iconSize={24}
              onClick={() => navigate('/settings')}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 0 20px' }}>
            {overdueCount > 0 && (
              <button
                type="button"
                onClick={() => navigate('/calendar')}
                className="speech-bubble"
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 16,
                  padding: '8px 16px',
                  border: 'none',
                  borderRadius: 24,
                  background: '#fdf1f1',
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: adaptive.red400,
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 'bold',
                    fontStyle: 'italic',
                    flexShrink: 0,
                  }}
                >
                  i
                </span>
                <span style={{ fontSize: 14, fontWeight: 600, color: adaptive.grey700 }}>
                  밀린 집안일 {overdueCount}개, 지금 해볼까요?
                </span>
              </button>
            )}
            <div key={remaining === 0 ? 'happy' : 'sad'} className="character-roll-in">
              <Asset.Image
                frameShape={{ width: 160 }}
                backgroundColor="transparent"
                src={remaining === 0 ? '/character-happy.png' : '/character-sad.png'}
                aria-hidden={true}
                style={{ aspectRatio: '1/1' }}
              />
            </div>
          </div>

          {/* 오늘 할 일 */}
          <div style={{ border: `1px solid ${adaptive.grey100}`, borderRadius: 16, padding: '16px 0', marginBottom: 16 }}>
            {today.length === 0 ? (
              <Post.H4 paddingBottom={0} style={{ padding: '0 16px' }} color={adaptive.greyOpacity900}>
                오늘은 집안일이 없어요.
              </Post.H4>
            ) : (
              <>
                <Post.H4 paddingBottom={16} style={{ padding: '0 16px 16px' }} color={adaptive.greyOpacity900}>
                  {remaining === 0 ? '오늘 집안일을 모두 완료했습니다!' : `오늘 해야할 일 ${remaining}개가 남았어요!`}
                </Post.H4>
                <List>
                  {today.map((o) => {
                    const isDone = o.status === 'done';
                    const isManual = o.completion_type === 'manual';
                    return (
                      <ListRow
                        key={o.id}
                        onClick={isManual ? handleManualClick : () => handleToggle(o)}
                        left={
                          <ListRow.AssetIcon
                            size="xsmall"
                            shape="original"
                            variant={isDone ? 'none' : 'fill'}
                            name={isDone ? 'icon-check-circle-blue' : 'icon-check-light-grey-fill'}
                          />
                        }
                        contents={
                          <ListRow.Texts
                            type="1RowTypeA"
                            top={o.chores.name}
                            topProps={{ color: isDone ? adaptive.grey400 : adaptive.grey700, typography: 'st10' }}
                          />
                        }
                        verticalPadding="small"
                        horizontalPadding="small"
                      />
                    );
                  })}
                </List>
              </>
            )}
          </div>

          {/* 앞으로 일주일 예정된 일 (보기 전용) */}
          <div style={{ border: `1px solid ${adaptive.grey100}`, borderRadius: 16, padding: '16px 0' }}>
            <Post.H4 paddingBottom={16} style={{ padding: '0 16px 16px' }} color={adaptive.greyOpacity900}>
              예정된 집안일
            </Post.H4>
            {week.length === 0 ? (
              <p style={{ color: adaptive.grey500, padding: '0 16px' }}>앞으로 일주일간 예정된 집안일이 없어요.</p>
            ) : (
              <List>
                {week.map((o) => (
                  <ListRow
                    key={o.id}
                    left={<ListRow.LeftText>{formatDateLabel(o.scheduled_date)}</ListRow.LeftText>}
                    contents={
                      <ListRow.Texts
                        type="1RowTypeA"
                        top={o.chores.name}
                        topProps={{ color: adaptive.grey700, typography: 'st10' }}
                      />
                    }
                    verticalPadding="small"
                    horizontalPadding="small"
                  />
                ))}
              </List>
            )}
          </div>
        </>
      )}
    </div>
  );
}
