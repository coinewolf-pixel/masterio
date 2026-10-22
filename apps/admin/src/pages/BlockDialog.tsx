import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import type { UserStatus } from '../api/types';
import { Dialog, ErrorNote, Field } from '../ui';

/** «Заблокировать» для активных и ограниченных; «Снять ограничения» для всех, кто не активен. */
export function BlockButtons({ status, onPick }: { status: UserStatus; onPick: (mode: 'block' | 'unblock') => void }) {
  const { t } = useTranslation();
  if (status === 'DELETED') return null;
  return (
    <>
      {status !== 'ACTIVE' ? (
        <button type="button" onClick={() => onPick('unblock')}>
          {t('people.unblock')}
        </button>
      ) : null}
      {status !== 'BLOCKED' ? (
        <button type="button" className="danger" onClick={() => onPick('block')}>
          {t('people.block')}
        </button>
      ) : null}
    </>
  );
}

/** Блокировка и снятие ограничений с обязательной причиной — пишется в журнал действий. */
export function BlockDialog({ userId, mode, onClose, onDone }: { userId: string; mode: 'block' | 'unblock' | null; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => (mode === 'block' ? api.block(userId, reason.trim()) : api.unblock(userId, reason.trim())),
    onSuccess: () => {
      setReason('');
      onDone();
      onClose();
    },
  });
  return (
    <Dialog open={mode !== null} onClose={onClose} title={mode === 'block' ? t('people.blockTitle') : t('people.unblockTitle')}>
      <p className="muted">{mode === 'block' ? t('people.blockHint') : t('people.unblockHint')}</p>
      <Field label={t('documents.reason')}>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />
      </Field>
      <ErrorNote error={m.error} />
      <div className="actions">
        <button type="button" onClick={onClose}>
          {t('common.close')}
        </button>
        <button type="button" className={mode === 'block' ? 'danger' : 'primary'} disabled={reason.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>
          {mode === 'block' ? t('people.block') : t('people.unblock')}
        </button>
      </div>
    </Dialog>
  );
}
