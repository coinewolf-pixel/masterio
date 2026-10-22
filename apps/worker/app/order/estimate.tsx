import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { api } from '../../src/api';
import type { EstimateItem } from '../../src/api/types';
import { money, parseAmount } from '../../src/format';
import { Button, Card, Chip, ErrorText, Field, Loading, Row, Screen, T } from '../../src/ui/components';
import { space, useColors } from '../../src/ui/theme';

const TYPES: EstimateItem['type'][] = ['LABOR', 'MATERIAL', 'TRAVEL', 'OTHER'];

interface Draft {
  type: EstimateItem['type'];
  title: string;
  quantity: string;
  price: string;
}

/** Смета: работа, материалы, выезд. Клиент подтверждает её в приложении — только так меняется сумма. */
export default function EstimateScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const order = useQuery({ queryKey: ['order', id], queryFn: () => api.orders.get(id) });
  const [items, setItems] = useState<Draft[]>([{ type: 'LABOR', title: '', quantity: '1', price: '' }]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  if (!order.data) return <Loading />;
  const currency = order.data.currency;

  const parsed = items.map((i) => ({ ...i, q: Number.parseInt(i.quantity, 10), cents: parseAmount(i.price) }));
  const valid = parsed.every((i) => i.title.trim().length > 0 && Number.isInteger(i.q) && i.q > 0 && i.cents !== null);
  const total = valid ? parsed.reduce((s, i) => s + i.q * (i.cents ?? 0), 0) : 0;

  const update = (idx: number, patch: Partial<Draft>) => setItems((list) => list.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.orders.proposeEstimate(
        id,
        parsed.map((i) => ({ type: i.type, title: i.title.trim(), quantity: i.q, unitCents: i.cents ?? 0 })),
        note.trim() || undefined,
      );
      await queryClient.invalidateQueries({ queryKey: ['order', id] });
      router.back();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <T variant="muted">{t('pro.estimate.hint')}</T>
      {items.map((item, idx) => (
        <Card key={idx}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {TYPES.map((type) => (
              <Chip key={type} label={t(`pro.estimate.type.${type}`)} selected={item.type === type} onPress={() => update(idx, { type })} />
            ))}
          </View>
          <Field label={t('pro.estimate.itemTitle')} value={item.title} onChangeText={(v) => update(idx, { title: v })} />
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Field label={t('pro.estimate.quantity')} value={item.quantity} onChangeText={(v) => update(idx, { quantity: v.replace(/\D/g, '') })} keyboardType="number-pad" />
            </View>
            <View style={{ flex: 2 }}>
              <Field label={t('pro.estimate.price', { currency })} value={item.price} onChangeText={(v) => update(idx, { price: v })} keyboardType="decimal-pad" />
            </View>
          </View>
          {items.length > 1 ? <Button title={t('pro.estimate.remove')} variant="ghost" onPress={() => setItems((l) => l.filter((_, i) => i !== idx))} /> : null}
        </Card>
      ))}
      <Button title={t('pro.estimate.add')} variant="secondary" onPress={() => setItems((l) => [...l, { type: 'MATERIAL', title: '', quantity: '1', price: '' }])} />
      <Field label={t('pro.estimate.note')} value={note} onChangeText={setNote} multiline />
      <Card>
        <Row label={t('pro.estimate.total')} value={money(total, currency)} strong />
      </Card>
      {!valid ? <T variant="small" style={{ color: c.textMuted }}>{t('pro.estimate.fillAll')}</T> : null}
      <ErrorText error={error} />
      <Button title={t('pro.estimate.send')} onPress={() => void submit()} loading={saving} disabled={!valid} />
    </Screen>
  );
}
