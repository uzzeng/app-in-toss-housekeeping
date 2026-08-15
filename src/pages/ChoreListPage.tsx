import { useEffect, useState, type FormEvent } from 'react';
import { Button, Checkbox } from '@toss/tds-mobile';
import { useCurrentUser } from '../hooks/useAnonymousKey';
import {
  CHORE_TYPE_LABEL,
  createChore,
  deleteChore,
  fetchChores,
  updateChore,
  type Chore,
  type ChoreInput,
  type ChoreType,
  type FixedUnit,
  type IntervalUnit,
  type RepeatMode,
} from '../lib/chores';

function describeChore(chore: Chore): string {
  if (chore.type === 'one_time') return `${chore.start_date} (1회)`;
  if (chore.type === 'annual_fixed') return `매년 ${chore.fixed_month}월 ${chore.fixed_day}일`;
  if (chore.repeat_mode === 'fixed_date') {
    return chore.fixed_unit === 'year'
      ? `매년 ${chore.fixed_month}월 ${chore.fixed_day}일`
      : `매달 ${chore.fixed_day}일`;
  }
  const unitLabel = chore.interval_unit === 'week' ? '주' : '일';
  return `${chore.interval_value}${unitLabel}마다`;
}

interface FormState {
  name: string;
  type: ChoreType;
  repeatMode: RepeatMode;
  intervalValue: string;
  intervalUnit: IntervalUnit;
  fixedUnit: FixedUnit;
  fixedMonth: string;
  fixedDay: string;
  startDate: string;
}

const initialForm: FormState = {
  name: '',
  type: 'general',
  repeatMode: 'interval',
  intervalValue: '1',
  intervalUnit: 'week',
  fixedUnit: 'month',
  fixedMonth: '1',
  fixedDay: '1',
  startDate: new Date().toISOString().slice(0, 10),
};

function formFromChore(chore: Chore): FormState {
  return {
    name: chore.name,
    type: chore.type,
    repeatMode: chore.repeat_mode ?? 'interval',
    intervalValue: String(chore.interval_value ?? 1),
    intervalUnit: chore.interval_unit ?? 'week',
    fixedUnit: chore.fixed_unit ?? 'month',
    fixedMonth: String(chore.fixed_month ?? 1),
    fixedDay: String(chore.fixed_day ?? 1),
    startDate: chore.start_date,
  };
}

function buildChoreInput(form: FormState): ChoreInput {
  const base: ChoreInput = {
    name: form.name.trim(),
    type: form.type,
    start_date: form.startDate,
  };

  if (form.type === 'one_time') return base;

  if (form.type === 'annual_fixed') {
    return { ...base, fixed_month: Number(form.fixedMonth), fixed_day: Number(form.fixedDay) };
  }

  // general
  if (form.repeatMode === 'interval') {
    return {
      ...base,
      repeat_mode: 'interval',
      interval_value: Number(form.intervalValue),
      interval_unit: form.intervalUnit,
    };
  }
  return {
    ...base,
    repeat_mode: 'fixed_date',
    fixed_unit: form.fixedUnit,
    fixed_month: form.fixedUnit === 'year' ? Number(form.fixedMonth) : undefined,
    fixed_day: Number(form.fixedDay),
  };
}

export function ChoreListPage() {
  const currentUser = useCurrentUser();
  const [chores, setChores] = useState<Chore[]>([]);
  const [loadingChores, setLoadingChores] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingChoreId, setEditingChoreId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const anonKey = currentUser.status === 'success' ? currentUser.user.anonKey : null;

  useEffect(() => {
    if (!anonKey) return;
    setLoadingChores(true);
    fetchChores(anonKey)
      .then(setChores)
      .catch((error: unknown) => setErrorMessage(error instanceof Error ? error.message : String(error)))
      .finally(() => setLoadingChores(false));
  }, [anonKey]);

  function openCreateForm() {
    setEditingChoreId(null);
    setForm(initialForm);
    setShowForm(true);
  }

  function openEditForm(chore: Chore) {
    setEditingChoreId(chore.id);
    setForm(formFromChore(chore));
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingChoreId(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!anonKey) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      if (editingChoreId) {
        const updated = await updateChore(anonKey, editingChoreId, buildChoreInput(form));
        setChores((prev) => prev.map((c) => (c.id === editingChoreId ? updated : c)));
      } else {
        const created = await createChore(anonKey, buildChoreInput(form));
        setChores((prev) => [...prev, created]);
      }
      closeForm();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleActive(chore: Chore) {
    if (!anonKey) return;
    try {
      const updated = await updateChore(anonKey, chore.id, { is_active: !chore.is_active });
      setChores((prev) => prev.map((c) => (c.id === chore.id ? updated : c)));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleDelete(chore: Chore) {
    if (!anonKey) return;
    try {
      await deleteChore(anonKey, chore.id);
      setChores((prev) => prev.filter((c) => c.id !== chore.id));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  if (currentUser.status === 'loading') {
    return <p>사용자 식별 중...</p>;
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
    <div style={{ padding: 16 }}>
      <h1>집안일 리스트</h1>

      {errorMessage && <p style={{ color: 'red' }}>{errorMessage}</p>}

      {loadingChores ? (
        <p>불러오는 중...</p>
      ) : chores.length === 0 ? (
        <p>등록된 집안일이 없어요. 아래 버튼으로 첫 집안일을 등록해보세요.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {chores.map((chore) => (
            <li
              key={chore.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 0',
                borderBottom: '1px solid #eee',
                opacity: chore.is_active ? 1 : 0.5,
              }}
            >
              <button
                type="button"
                onClick={() => openEditForm(chore)}
                style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', flex: 1 }}
              >
                <div>{chore.name}</div>
                <div style={{ fontSize: 13, color: '#888' }}>
                  {CHORE_TYPE_LABEL[chore.type]} · {describeChore(chore)}
                </div>
              </button>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Checkbox.Circle
                  checked={chore.is_active}
                  onCheckedChange={() => handleToggleActive(chore)}
                />
                <Button size="small" variant="weak" color="danger" onClick={() => handleDelete(chore)}>
                  삭제
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!showForm && (
        <Button display="full" onClick={openCreateForm}>
          집안일 등록
        </Button>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
          <label>
            이름
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
              style={{ display: 'block', width: '100%' }}
            />
          </label>

          <label>
            유형
            <select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as ChoreType }))}
              style={{ display: 'block', width: '100%' }}
            >
              <option value="general">일반 반복형</option>
              <option value="annual_fixed">연1회 고정시즌형</option>
              <option value="one_time">수시 등록형</option>
            </select>
          </label>

          {form.type === 'general' && (
            <>
              <label>
                반복 방식
                <select
                  value={form.repeatMode}
                  onChange={(e) => setForm((f) => ({ ...f, repeatMode: e.target.value as RepeatMode }))}
                  style={{ display: 'block', width: '100%' }}
                >
                  <option value="interval">주기 (N일/N주마다)</option>
                  <option value="fixed_date">날짜 고정 (매달/매년)</option>
                </select>
              </label>

              {form.repeatMode === 'interval' && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="number"
                    min={1}
                    value={form.intervalValue}
                    onChange={(e) => setForm((f) => ({ ...f, intervalValue: e.target.value }))}
                    style={{ width: 80 }}
                  />
                  <select
                    value={form.intervalUnit}
                    onChange={(e) => setForm((f) => ({ ...f, intervalUnit: e.target.value as IntervalUnit }))}
                  >
                    <option value="day">일마다</option>
                    <option value="week">주마다</option>
                  </select>
                </div>
              )}

              {form.repeatMode === 'fixed_date' && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <select
                    value={form.fixedUnit}
                    onChange={(e) => setForm((f) => ({ ...f, fixedUnit: e.target.value as FixedUnit }))}
                  >
                    <option value="month">매달</option>
                    <option value="year">매년</option>
                  </select>
                  {form.fixedUnit === 'year' && (
                    <input
                      type="number"
                      min={1}
                      max={12}
                      placeholder="월"
                      value={form.fixedMonth}
                      onChange={(e) => setForm((f) => ({ ...f, fixedMonth: e.target.value }))}
                      style={{ width: 60 }}
                    />
                  )}
                  <input
                    type="number"
                    min={1}
                    max={31}
                    placeholder="일"
                    value={form.fixedDay}
                    onChange={(e) => setForm((f) => ({ ...f, fixedDay: e.target.value }))}
                    style={{ width: 60 }}
                  />
                </div>
              )}
            </>
          )}

          {form.type === 'annual_fixed' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="number"
                min={1}
                max={12}
                placeholder="월"
                value={form.fixedMonth}
                onChange={(e) => setForm((f) => ({ ...f, fixedMonth: e.target.value }))}
                style={{ width: 60 }}
              />
              <input
                type="number"
                min={1}
                max={31}
                placeholder="일"
                value={form.fixedDay}
                onChange={(e) => setForm((f) => ({ ...f, fixedDay: e.target.value }))}
                style={{ width: 60 }}
              />
            </div>
          )}

          <label>
            최초 시작일
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              required
              style={{ display: 'block', width: '100%' }}
            />
          </label>

          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="submit" loading={submitting} display="full">
              {editingChoreId ? '수정' : '등록'}
            </Button>
            <Button type="button" variant="weak" onClick={closeForm}>
              취소
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
