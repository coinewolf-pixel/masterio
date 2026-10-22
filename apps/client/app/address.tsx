import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import type { LatLng } from '@masterio/shared';
import { api } from '../src/api';
import { USE_GOOGLE_MAPS } from '../src/config';
import { useDraft } from '../src/draft/NewOrderProvider';
import { Button, Card, ErrorText, Field, Screen, T } from '../src/ui/components';
import { radius, space, useColors } from '../src/ui/theme';

const DEFAULT_DELTA = 0.006;

/** Токен сессии автодополнения Google: подсказки и выбор места оплачиваются как одна сессия. */
function newSessionToken(): string {
  return Crypto.randomUUID();
}

/**
 * Выбор адреса: поиск с подсказками, «Моё местоположение» (GPS), уточнение на карте перетаскиванием
 * (точка — центр карты), сохранённые адреса, подъезд/этаж/квартира.
 */
export default function AddressScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { draft, update } = useDraft();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [session, setSession] = useState(newSessionToken);
  const [point, setPoint] = useState<LatLng | null>(draft.address?.location ?? null);
  const [formatted, setFormatted] = useState(draft.address?.formatted ?? '');
  const [placeId, setPlaceId] = useState<string | undefined>(draft.address?.placeId);
  const [details, setDetails] = useState(draft.address?.details ?? '');
  const [save, setSave] = useState(draft.address?.save ?? false);
  const [label, setLabel] = useState(draft.address?.label ?? '');
  const [error, setError] = useState<unknown>(null);
  const [locating, setLocating] = useState(false);
  const [resolving, setResolving] = useState(false);
  const mapRef = useRef<MapView>(null);
  // программное перемещение карты не должно заново определять адрес — он уже известен
  const skipNextRegion = useRef(false);

  const saved = useQuery({ queryKey: ['addresses'], queryFn: api.me.addresses });

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(id);
  }, [query]);

  const suggestions = useQuery({
    queryKey: ['autocomplete', debounced, session],
    queryFn: () => api.geo.autocomplete(debounced, point, session),
    enabled: debounced.length >= 2,
    retry: false,
    staleTime: 60_000,
  });

  const moveTo = (p: LatLng) => {
    setPoint(p);
    skipNextRegion.current = true;
    mapRef.current?.animateToRegion({ latitude: p.lat, longitude: p.lng, latitudeDelta: DEFAULT_DELTA, longitudeDelta: DEFAULT_DELTA }, 400);
  };

  const pickSuggestion = async (id: string) => {
    setError(null);
    setResolving(true);
    try {
      const place = await api.geo.place(id, session);
      setFormatted(place.formatted);
      setPlaceId(place.placeId);
      setQuery('');
      setDebounced('');
      setSession(newSessionToken());
      moveTo(place.location);
    } catch (e) {
      setError(e);
    } finally {
      setResolving(false);
    }
  };

  const reverse = async (p: LatLng) => {
    setResolving(true);
    try {
      const res = await api.geo.reverse(p);
      setFormatted(res.formatted);
      setPlaceId(res.placeId ?? undefined);
    } catch (e) {
      setError(e);
    } finally {
      setResolving(false);
    }
  };

  const locateMe = async () => {
    setError(null);
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        setError(new Error('permission'));
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      moveTo(p);
      await reverse(p);
    } catch (e) {
      setError(e);
    } finally {
      setLocating(false);
    }
  };

  const onRegionChangeComplete = (region: Region, details?: { isGesture?: boolean }) => {
    if (skipNextRegion.current) {
      skipNextRegion.current = false;
      return;
    }
    if (details && details.isGesture === false) return;
    const p = { lat: region.latitude, lng: region.longitude };
    setPoint(p);
    void reverse(p);
  };

  const confirm = () => {
    if (!point || formatted.trim().length < 3) return;
    update({
      address: {
        formatted: formatted.trim(),
        details: details.trim() || undefined,
        placeId,
        location: point,
        save,
        label: save && label.trim() ? label.trim() : undefined,
      },
    });
    router.back();
  };

  const permissionError = error instanceof Error && error.message === 'permission';

  return (
    <Screen>
      <Field
        label={t('client.address.search')}
        placeholder={t('client.address.searchPlaceholder')}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        autoFocus={!draft.address}
      />
      {(suggestions.data ?? []).map((s) => (
        <Pressable key={s.placeId} onPress={() => void pickSuggestion(s.placeId)} style={[styles.suggestion, { borderColor: c.border }]} accessibilityRole="button">
          <Ionicons name="location-outline" size={18} color={c.textMuted} />
          <View style={{ flex: 1 }}>
            <T>{s.primary}</T>
            {s.secondary ? <T variant="small">{s.secondary}</T> : null}
          </View>
        </Pressable>
      ))}
      {suggestions.error ? <ErrorText error={suggestions.error} /> : null}

      <Button title={t('client.address.myLocation')} variant="secondary" onPress={() => void locateMe()} loading={locating} />

      {(saved.data ?? []).length > 0 && !point ? (
        <View style={{ gap: space.sm }}>
          <T variant="small">{t('client.address.saved')}</T>
          {(saved.data ?? []).map((a) => (
            <Card
              key={a.id}
              onPress={() => {
                setFormatted(a.formatted);
                setPlaceId(a.placeId ?? undefined);
                setDetails(a.details ?? '');
                setSave(false);
                moveTo({ lat: a.lat, lng: a.lng });
              }}
            >
              {a.label ? <T variant="h2">{a.label}</T> : null}
              <T variant={a.label ? 'muted' : 'body'}>{a.formatted}</T>
            </Card>
          ))}
        </View>
      ) : null}

      {point ? (
        <>
          <View style={[styles.mapBox, { borderColor: c.border }]}>
            <MapView
              ref={mapRef}
              style={StyleSheet.absoluteFill}
              provider={USE_GOOGLE_MAPS ? PROVIDER_GOOGLE : undefined}
              initialRegion={{ latitude: point.lat, longitude: point.lng, latitudeDelta: DEFAULT_DELTA, longitudeDelta: DEFAULT_DELTA }}
              onRegionChangeComplete={onRegionChangeComplete}
              showsUserLocation
              rotateEnabled={false}
              pitchEnabled={false}
            />
            <View pointerEvents="none" style={styles.pinWrap}>
              <Ionicons name="location" size={42} color={c.primary} />
            </View>
          </View>
          <T variant="small">{t('client.address.dragHint')}</T>
          <Card>
            <T variant="small">{t('client.address.selected')}</T>
            <T variant="h2">{resolving ? t('client.address.resolving') : formatted || '—'}</T>
          </Card>
          <Field label={t('client.address.details')} placeholder={t('client.address.detailsPlaceholder')} value={details} onChangeText={setDetails} maxLength={300} />
          <View style={styles.saveRow}>
            <T style={{ flex: 1 }}>{t('client.address.save')}</T>
            <Switch value={save} onValueChange={setSave} trackColor={{ true: c.primary, false: c.border }} />
          </View>
          {save ? <Field label={t('client.address.label')} placeholder={t('client.address.labelPlaceholder')} value={label} onChangeText={setLabel} maxLength={60} /> : null}
        </>
      ) : null}

      {permissionError ? <T variant="small" style={{ color: c.danger }}>{t('client.address.permissionDenied')}</T> : <ErrorText error={error} />}
      <Button title={t('client.address.confirm')} onPress={confirm} disabled={!point || resolving || formatted.trim().length < 3} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  mapBox: { height: 260, borderRadius: radius.lg, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  pinWrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingBottom: 42 },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
