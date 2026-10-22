import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { distance, localized, secondsLeft } from '../format';
import { Banner, Button, ErrorText, T } from '../ui/components';
import { radius, space, useColors } from '../ui/theme';
import { useWork } from './WorkProvider';

/**
 * Карточка предложения заказа с обратным отсчётом. Отсчёт — только отображение:
 * решает серверное время, поэтому после нуля кнопка «Принять» блокируется, а сервер закроет предложение сам.
 */
export function OfferSheet() {
  const { t } = useTranslation();
  const c = useColors();
  const { offer, accept, decline, lostOfferReason, clearLostOffer } = useWork();
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.catalog.categories(), staleTime: 3_600_000 });

  useEffect(() => {
    if (!offer) return;
    setError(null);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    const tick = () => setLeft(secondsLeft(offer.offer.expiresAt, offer.serverOffsetMs));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [offer]);

  useEffect(() => {
    if (!lostOfferReason) return;
    const timer = setTimeout(clearLostOffer, 4_000);
    return () => clearTimeout(timer);
  }, [lostOfferReason, clearLostOffer]);

  const category = categories.data?.flatMap((g) => g.categories).find((x) => x.id === offer?.offer.categoryId);
  const units = { m: t('units.m'), km: t('units.km') };

  return (
    <>
      {lostOfferReason ? (
        <View style={styles.toast} pointerEvents="none">
          <Banner tone="warning" text={t('pro.offer.unavailable')} />
        </View>
      ) : null}
      <Modal visible={offer !== null} transparent animationType="slide" onRequestClose={() => undefined}>
        <View style={styles.backdrop}>
          {offer ? (
            <View style={[styles.sheet, { backgroundColor: c.surface }]}>
              <View style={styles.header}>
                <T variant="h2">{offer.offer.isUrgent ? t('pro.offer.urgentTitle') : t('pro.offer.title')}</T>
                <View style={[styles.timer, { borderColor: left <= 5 ? c.danger : c.primary }]}>
                  <T variant="money" style={{ color: left <= 5 ? c.danger : c.primary }}>{left}</T>
                </View>
              </View>
              <T variant="h2">{localized(category?.names, offer.offer.categoryCode)}</T>
              <T variant="muted">{t('pro.offer.distance', { distance: distance(offer.offer.distanceM, units) })}</T>
              <T>{offer.offer.description}</T>
              <T variant="small">{offer.offer.paymentMethod === 'CASH' ? t('pro.offer.cash') : t('pro.offer.card')}</T>
              <ErrorText error={error} />
              <View style={styles.actions}>
                <Button
                  title={t('pro.offer.decline')}
                  variant="secondary"
                  style={{ flex: 1 }}
                  loading={busy === 'decline'}
                  disabled={busy !== null}
                  onPress={() => {
                    setBusy('decline');
                    void decline().finally(() => setBusy(null));
                  }}
                />
                <Button
                  title={t('pro.offer.accept')}
                  style={{ flex: 2 }}
                  loading={busy === 'accept'}
                  disabled={busy !== null || left === 0}
                  onPress={() => {
                    setBusy('accept');
                    accept()
                      .then(() => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success))
                      .catch((e: unknown) => setError(e))
                      .finally(() => setBusy(null));
                  }}
                />
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space.xl, gap: space.md, paddingBottom: space.xxl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timer: { width: 64, height: 64, borderRadius: 32, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: space.md, marginTop: space.sm },
  toast: { position: 'absolute', top: 56, left: space.lg, right: space.lg, zIndex: 10 },
});
