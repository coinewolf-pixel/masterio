import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import type { LatLng } from '@masterio/shared';
import { USE_GOOGLE_MAPS } from '../config';
import { distance } from '../format';
import { T } from '../ui/components';
import { accent, radius, space, useColors } from '../ui/theme';
import { etaParts, regionFor } from './smooth';
import type { LiveWorker } from './useLiveWorker';

const toCoord = (p: LatLng) => ({ latitude: p.lat, longitude: p.lng });

/**
 * Карта «как в такси»: адрес клиента, машина мастера (повёрнута по направлению движения и плавно едет),
 * пройденный путь, пунктир до адреса, расстояние и время прибытия. Пока клиент не трогает карту,
 * она сама держит в кадре и мастера, и адрес.
 */
export function LiveMap({ address, live }: { address: LatLng; live: LiveWorker }) {
  const { t } = useTranslation();
  const c = useColors();
  const mapRef = useRef<MapView>(null);
  const [follow, setFollow] = useState(true);
  const units = { m: t('units.m'), km: t('units.km') };

  const { position } = live;
  // кадр перестраиваем при новой целевой точке, а не на каждом кадре анимации — позицию читаем из ref
  const positionRef = useRef(position);
  positionRef.current = position;
  const { lat, lng } = address;
  useEffect(() => {
    const p = positionRef.current;
    if (!follow || !p) return;
    mapRef.current?.animateToRegion(regionFor([p, { lat, lng }]), 600);
  }, [follow, live.lastUpdate, lat, lng]);

  const eta = etaParts(live.etaSeconds);
  const etaText = eta ? (eta.hours > 0 ? t('client.track.etaHours', { hours: eta.hours, minutes: eta.minutes }) : t('client.track.etaMinutes', { count: eta.minutes })) : null;

  return (
    <View style={[styles.box, { borderColor: c.border }]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={USE_GOOGLE_MAPS ? PROVIDER_GOOGLE : undefined}
        initialRegion={regionFor(position ? [position, address] : [address])}
        onPanDrag={() => setFollow(false)}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
      >
        <Marker coordinate={toCoord(address)} title={t('client.track.destination')} pinColor={c.primary} />
        {live.path.length > 1 ? <Polyline coordinates={live.path.map(toCoord)} strokeColor={c.primary} strokeWidth={4} /> : null}
        {position ? (
          <>
            <Polyline coordinates={[toCoord(position), toCoord(address)]} strokeColor={c.textMuted} strokeWidth={2} lineDashPattern={[8, 8]} />
            <Marker coordinate={toCoord(position)} anchor={{ x: 0.5, y: 0.5 }} flat rotation={live.heading} title={t('client.track.worker')}>
              <View style={[styles.car, { backgroundColor: c.primary, opacity: live.connectionLost ? 0.5 : 1 }]}>
                <Ionicons name="navigate" size={20} color={accent} />
              </View>
            </Marker>
          </>
        ) : null}
      </MapView>

      <View style={[styles.info, { backgroundColor: c.surface, borderColor: c.border }]}>
        {position ? (
          <>
            {etaText ? <T variant="h2">{etaText}</T> : null}
            {live.distanceM !== null ? <T variant="small">{t('client.track.distance', { distance: distance(live.distanceM, units) })}</T> : null}
          </>
        ) : (
          <T variant="small">{t('client.track.waitingGps')}</T>
        )}
        {live.connectionLost ? <T variant="small" style={{ color: c.warning }}>{t('client.track.connectionLost')}</T> : null}
      </View>

      {!follow ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('client.track.recenter')}
          onPress={() => setFollow(true)}
          style={[styles.recenter, { backgroundColor: c.surface, borderColor: c.border }]}
        >
          <Ionicons name="locate" size={22} color={c.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { height: 320, borderRadius: radius.lg, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  car: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF' },
  info: { position: 'absolute', left: space.sm, right: space.sm, bottom: space.sm, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, padding: space.md, gap: 2 },
  recenter: { position: 'absolute', right: space.sm, top: space.sm, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
});
