import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { setTimezone } from '@/lib/format';
import type { Lookups } from '@/lib/types';

export function useLookups() {
  return useQuery({
    queryKey: ['lookups'],
    queryFn: async () => { const l = await api.get<Lookups>('/lookups'); setTimezone(l.settings.timezone); return l; },
    staleTime: 5 * 60_000,
  });
}
