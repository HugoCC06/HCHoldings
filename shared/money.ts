// All money is stored as integer minor units (pence/cents) to avoid floating point drift.

/** Parse a user-entered amount such as "1,234.50", "£99", "-12" into minor units. Returns null when invalid. */
export function parseMoney(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;
  let s = input.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[£$€\s,]/g, '').replace(/^(GBP|USD|EUR)/i, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  if (!/^\d+(\.\d{0,2})?$|^\.\d{1,2}$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const minor = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(minor)) return null;
  return negative ? -minor : minor;
}

/** Minor units -> plain decimal string for inputs, e.g. 123456 -> "1234.56". */
export function minorToInput(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return '';
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return (neg ? '-' : '') + s.replace(/\.00$/, '');
}

const formatters = new Map<string, Intl.NumberFormat>();
function fmt(currency: string, compact: boolean, decimals: boolean) {
  const key = `${currency}|${compact}|${decimals}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      notation: compact ? 'compact' : 'standard',
      minimumFractionDigits: compact ? 0 : decimals ? 2 : 0,
      maximumFractionDigits: compact ? 1 : decimals ? 2 : 0,
    });
    formatters.set(key, f);
  }
  return f;
}

export function formatMoney(
  minor: number | null | undefined,
  currency = 'GBP',
  opts: { compact?: boolean; decimals?: boolean } = {},
): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return '—';
  return fmt(currency, !!opts.compact, opts.decimals ?? true).format(minor / 100);
}

export function formatPct(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatSignedPct(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
  const v = ratio * 100;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}%`;
}
