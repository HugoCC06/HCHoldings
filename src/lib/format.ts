import { useCallback } from 'react';
import { formatMoney } from '../../shared/money';
import { useSnapshot } from './api';

export function useCurrency(): string {
  return useSnapshot().data?.settings.currency ?? 'GBP';
}

/** Currency-aware money formatter bound to the user's settings. */
export function useMoney() {
  const currency = useCurrency();
  return useCallback(
    (minor: number | null | undefined, opts?: { compact?: boolean; decimals?: boolean }) => formatMoney(minor, currency, opts),
    [currency],
  );
}

export function formatNumber(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-GB', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
