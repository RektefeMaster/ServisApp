import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/** Sekme başlığı bölümü söyler; operatör aynı anda birkaç sekme açık tutuyor. */
export const metadata: Metadata = { title: 'Olaylar' };

export default function SectionLayout({ children }: { children: ReactNode }) {
  return children;
}
