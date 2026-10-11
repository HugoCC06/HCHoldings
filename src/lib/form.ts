import { useState } from 'react';
import { ApiError } from './api';
import { parseMoney } from '../../shared/money';

export type FieldErrors = Record<string, string | undefined>;

export function useForm<T extends Record<string, unknown>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = <K extends keyof T>(key: K, value: T[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key as string]) setErrors((e) => ({ ...e, [key as string]: undefined }));
  };
  const handleError = (e: unknown) => {
    if (e instanceof ApiError) {
      setFormError(e.message);
      if (e.fields) setErrors(Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [k, v?.[0]])));
    } else setFormError((e as Error).message ?? 'Something went wrong');
  };
  return { values, set, setValues, errors, setErrors, formError, setFormError, handleError };
}

/**
 * Converts money input strings to minor units. Collects errors for invalid entries.
 * Empty strings become null (or an error when required).
 */
export function moneyFields(values: Record<string, unknown>, keys: string[], required: string[] = []) {
  const out: Record<string, number | null> = {};
  const errors: FieldErrors = {};
  for (const k of keys) {
    const raw = String(values[k] ?? '').trim();
    if (!raw) {
      out[k] = null;
      if (required.includes(k)) errors[k] = 'Required';
      continue;
    }
    const v = parseMoney(raw);
    if (v === null) errors[k] = 'Enter an amount like 1234.56';
    out[k] = v;
  }
  return { out, errors, ok: Object.keys(errors).length === 0 };
}

export const numOrNull = (s: unknown): number | null => {
  const str = String(s ?? '').trim();
  if (!str) return null;
  const n = Number(str.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
export const idOrNull = (s: unknown): number | null => (s ? Number(s) : null);
