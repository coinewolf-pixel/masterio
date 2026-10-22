import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api } from './api';
import { localized } from './format';

/** Справочники для подписей в таблицах: название услуги и города по id. */
export function useCatalog() {
  const query = useQuery({ queryKey: ['catalog'], queryFn: api.catalog, staleTime: 300_000 });
  const data = query.data;
  const categoryName = useCallback(
    (id: string | null | undefined) => {
      if (!id) return '—';
      const cat = data?.groups.flatMap((g) => g.categories).find((c) => c.id === id);
      return cat ? localized(cat.names, cat.code) : id.slice(0, 8);
    },
    [data],
  );
  const cityName = useCallback(
    (id: string | null | undefined) => {
      if (!id) return '—';
      const city = data?.cities.find((c) => c.id === id);
      return city ? localized(city.names, city.countryCode) : id.slice(0, 8);
    },
    [data],
  );
  return { ...query, categoryName, cityName };
}
