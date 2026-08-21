import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Checkbox, List, ListRow, useDialog } from '@toss/tds-mobile';
import { adaptive } from '@toss/tds-colors';
import { useCurrentUser } from '../hooks/useAnonymousKey';
import { CHORE_TYPE_LABEL, choresCache, deleteChore, fetchChores, updateChore, type Chore } from '../lib/chores';

function describeChore(chore: Chore): string {
  if (chore.type === 'one_time') return `${chore.start_date} (1회)`;
  if (chore.repeat_mode === 'fixed_date') {
    return chore.fixed_unit === 'year'
      ? `매년 ${chore.fixed_month}월 ${chore.fixed_day}일`
      : `매달 ${chore.fixed_day}일`;
  }
  const unitLabel = chore.interval_unit === 'week' ? '주' : '일';
  return `${chore.interval_value}${unitLabel}마다`;
}

export function ChoreListPage() {
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const { openAsyncConfirm } = useDialog();
  const anonKey = currentUser.status === 'success' ? currentUser.user.anonKey : null;
  const [chores, setChores] = useState<Chore[]>(() => (anonKey ? choresCache.get(anonKey) ?? [] : []));
  const [loadingChores, setLoadingChores] = useState(() => !(anonKey && choresCache.has(anonKey)));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!anonKey) return;
    if (!choresCache.has(anonKey)) setLoadingChores(true);
    fetchChores(anonKey)
      .then(setChores)
      .catch((error: unknown) => setErrorMessage(error instanceof Error ? error.message : String(error)))
      .finally(() => setLoadingChores(false));
  }, [anonKey]);

  async function handleToggleActive(chore: Chore) {
    if (!anonKey) return;
    try {
      const updated = await updateChore(anonKey, chore.id, { is_active: !chore.is_active });
      setChores((prev) => {
        const next = prev.map((c) => (c.id === chore.id ? updated : c));
        choresCache.set(anonKey, next);
        return next;
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleDelete(chore: Chore) {
    if (!anonKey) return;
    const confirmed = await openAsyncConfirm({
      title: '집안일을 삭제할까요?',
      description: '삭제하면 되돌릴 수 없어요.',
      confirmButton: '삭제하기',
      cancelButton: '취소',
      onConfirmClick: async () => {
        await deleteChore(anonKey, chore.id);
      },
    });
    if (!confirmed) return;
    setChores((prev) => {
      const next = prev.filter((c) => c.id !== chore.id);
      choresCache.set(anonKey, next);
      return next;
    });
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
      <p
        style={{
          margin: '0 0 12px',
          padding: '0 16px',
          fontSize: 22,
          fontWeight: 'bold',
          color: adaptive.grey900,
        }}
      >
        집안일 리스트
      </p>

      {errorMessage && (
        <p style={{ padding: '0 16px', color: adaptive.red500, fontSize: 13 }}>{errorMessage}</p>
      )}

      {loadingChores ? (
        <p style={{ padding: '0 16px' }}>불러오는 중...</p>
      ) : (
        <List>
          {chores.map((chore) => (
            <ListRow
              key={chore.id}
              onClick={() => navigate(`/chores/${chore.id}/history`)}
              left={
                <div onClick={(e) => e.stopPropagation()}>
                  <Checkbox.Circle
                    size={24}
                    checked={chore.is_active}
                    onCheckedChange={() => handleToggleActive(chore)}
                  />
                </div>
              }
              contents={
                <ListRow.Texts
                  type="2RowTypeA"
                  top={chore.name}
                  topProps={{ color: adaptive.grey800, fontWeight: 'bold' }}
                  bottom={`${CHORE_TYPE_LABEL[chore.type]} ・ ${describeChore(chore)}`}
                  bottomProps={{ color: adaptive.grey600, typography: 'st12' }}
                />
              }
              right={
                <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                  <Button size="small" variant="weak" onClick={() => navigate(`/chores/${chore.id}/edit`)}>
                    수정
                  </Button>
                  <Button size="small" variant="weak" color="danger" onClick={() => handleDelete(chore)}>
                    삭제
                  </Button>
                </div>
              }
              verticalPadding="large"
              horizontalPadding="small"
            />
          ))}
          <ListRow
            onClick={() => navigate('/chores/new')}
            left={<ListRow.AssetIcon shape="original" name="icon-plus-grey-fill" variant="fill" />}
            contents={
              <ListRow.Texts type="1RowTypeA" top="추가하기" topProps={{ color: adaptive.grey700 }} />
            }
            verticalPadding="large"
            horizontalPadding="small"
          />
        </List>
      )}
    </div>
  );
}
