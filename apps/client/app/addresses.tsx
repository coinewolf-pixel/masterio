import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import { api } from '../src/api';
import { Button, Card, ErrorText, Loading, Screen, T } from '../src/ui/components';

/** Сохранённые адреса: просмотр и удаление (добавляются при оформлении заказа). */
export default function AddressesScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const addresses = useQuery({ queryKey: ['addresses'], queryFn: api.me.addresses });
  const [error, setError] = useState<unknown>(null);

  const remove = (id: string) => {
    Alert.alert(t('client.addresses.deleteTitle'), undefined, [
      { text: t('client.common.cancel'), style: 'cancel' },
      {
        text: t('client.addresses.delete'),
        style: 'destructive',
        onPress: () => {
          setError(null);
          api.me
            .deleteAddress(id)
            .then(() => queryClient.invalidateQueries({ queryKey: ['addresses'] }))
            .catch(setError);
        },
      },
    ]);
  };

  if (addresses.isLoading) return <Loading />;

  return (
    <Screen refreshing={addresses.isRefetching} onRefresh={() => void addresses.refetch()}>
      <ErrorText error={error ?? addresses.error} />
      {(addresses.data ?? []).length === 0 ? <T variant="muted" center>{t('client.addresses.empty')}</T> : null}
      {(addresses.data ?? []).map((a) => (
        <Card key={a.id}>
          {a.label ? <T variant="h2">{a.label}</T> : null}
          <T>{a.formatted}</T>
          {a.details ? <T variant="muted">{a.details}</T> : null}
          <Button title={t('client.addresses.delete')} variant="ghost" onPress={() => remove(a.id)} />
        </Card>
      ))}
    </Screen>
  );
}
