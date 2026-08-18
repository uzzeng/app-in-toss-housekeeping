import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Asset, IconButton, List, ListRow, Post, useDialog } from '@toss/tds-mobile';
import { adaptive } from '@toss/tds-colors';
import { useCurrentUser } from '../hooks/useAnonymousKey';
import {
  fetchTodayOccurrences,
  fetchWeekOccurrences,
  setOccurrenceCompleted,
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
  const [today, setToday] = useState<Occurrence[]>([]);
  const [week, setWeek] = useState<Occurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const anonKey = currentUser.status === 'success' ? currentUser.user.anonKey : null;

  useEffect(() => {
    if (!anonKey) return;
    setLoading(true);
    Promise.all([fetchTodayOccurrences(anonKey), fetchWeekOccurrences(anonKey)])
      .then(([todayList, weekList]) => {
        setToday(todayList);
        setWeek(weekList);
      })
      .catch((error: unknown) => setErrorMessage(error instanceof Error ? error.message : String(error)))
      .finally(() => setLoading(false));
  }, [anonKey]);

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
    setToday((prev) => applyStatus(prev, occurrence.id, nextStatus));
    try {
      await setOccurrenceCompleted(anonKey, occurrence.id, nextCompleted);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      // 실패 시 원복
      setToday((prev) => applyStatus(prev, occurrence.id, occurrence.status));
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
      {errorMessage && <p style={{ color: 'red' }}>{errorMessage}</p>}

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

          <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 20px' }}>
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
