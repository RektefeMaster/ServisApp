'use client';

import type { ChangeEvent, FormEvent, ReactNode } from 'react';

/**
 * Panelin form yapı taşları.
 *
 * Operasyon masasında her ekran aynı görünmek zorunda: bir kaza anında
 * yönetici düğmeyi aramakla vakit kaybetmemeli. Bu yüzden alanlar, hata
 * satırları ve kaydet düğmesi tek yerden gelir.
 */

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 rounded-2xl border border-rule bg-white p-5 shadow-sm sm:p-6">
      <h2 className="font-serif text-lg tracking-tight">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="text-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

/**
 * Ortak alan sınıfı.
 *
 * `py-1` ile alanlar 26 punto yüksekliğindeydi ve odak halkası yoktu: klavyeyle
 * gezen operatör nerede olduğunu göremiyor, fare kullanan da kaza anında küçük
 * hedefleri ıskalıyordu. Yükseklik ve görünür odak, bu ekranın işlevidir.
 */
const inputClass =
  'mt-1 w-full min-h-11 rounded-lg border border-field bg-white px-3 py-2 text-sm ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  type = 'text',
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  hint?: string;
  type?: 'text' | 'date' | 'time' | 'tel' | 'email';
  inputMode?: 'numeric' | 'decimal' | 'tel';
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        className={inputClass}
        type={type}
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          onChange(event.target.value);
        }}
      />
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <select
        className={inputClass}
        value={value}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => {
          onChange(event.target.value as T);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function CheckField({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        checked={checked}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          onChange(event.target.checked);
        }}
      />
      <span>
        {label}
        {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

export function FormGrid({
  onSubmit,
  children,
  busy,
  submitLabel,
}: {
  onSubmit: () => void | Promise<void>;
  children: ReactNode;
  busy: boolean;
  submitLabel: string;
}) {
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void onSubmit();
      }}
    >
      {children}
      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={busy}
          aria-busy={busy}
          className="min-h-11 rounded-lg bg-ink px-5 py-2 text-sm font-medium text-paper shadow-sm transition-colors hover:bg-[#33524d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50"
        >
          {busy ? 'Kaydediliyor…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

/**
 * Sonuç satırı. `role` ile duyurulur: eskiden sessiz bir paragraftı ve kaydet
 * düğmesine basan operatör, uzun formun altındaki hatayı fark etmeden aynı
 * kaydı ikinci kez gönderiyordu.
 */
export function Notice({ error, ok }: { error?: string | null; ok?: string | null }) {
  if (error) {
    return (
      <p
        role="alert"
        className="mt-2 rounded border border-red-700/30 bg-red-50 px-3 py-2 text-sm text-red-700"
      >
        {error}
      </p>
    );
  }
  if (ok) {
    return (
      <p
        role="status"
        className="mt-2 rounded border border-green-700/30 bg-green-50 px-3 py-2 text-sm text-green-700"
      >
        {ok}
      </p>
    );
  }
  return null;
}

/** Geri alınamaz eylemler için yazılı onay. */
export function confirmDestructive(message: string): boolean {
  return window.confirm(message);
}
