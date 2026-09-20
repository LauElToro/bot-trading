import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink, ShieldAlert } from 'lucide-react';
import { BrandMark } from '@/components/brand-mark';
import { LanguageToggle, useLang } from '@/i18n';
import { api } from '@/lib/api-client';
import { ThemeToggle } from '@/components/theme-toggle';

const COPY = {
  es: {
    eyebrow: 'DOCUMENTO LEGAL',
    title: 'Términos y condiciones de uso',
    summary:
      'Toro automatiza órdenes de grid trading en GRVT. No recibe depósitos, no custodia fondos y no utiliza permisos de retiro o transferencia.',
    warning:
      'Los futuros perpetuos y el apalancamiento son de alto riesgo. Podés perder la totalidad del capital asignado.',
    back: 'Volver al inicio',
    signup: 'Crear cuenta',
    loading: 'Cargando la versión vigente…',
    error: 'No pudimos cargar los términos vigentes. No crees una cuenta hasta poder revisarlos.',
    version: 'Versión vigente',
  },
  en: {
    eyebrow: 'LEGAL DOCUMENT',
    title: 'Terms and conditions of use',
    summary:
      'Toro automates grid-trading orders on GRVT. It does not receive deposits, custody funds, or use withdrawal or transfer permissions.',
    warning:
      'Perpetual futures and leverage are high risk. You can lose all allocated capital.',
    back: 'Back to home',
    signup: 'Create account',
    loading: 'Loading the current version…',
    error: 'We could not load the current terms. Do not create an account until you can review them.',
    version: 'Current version',
  },
} as const;

export function TermsPage() {
  const { lang } = useLang();
  const copy = COPY[lang];
  const [terms, setTerms] = useState<{ version: string; texts: { en: string; es: string } } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getTos()
      .then((response) => {
        if (!cancelled) {
          setTerms({
            version: response.version,
            texts: response.texts ?? { en: response.text, es: response.text },
          });
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.title = lang === 'es'
      ? 'Términos y condiciones | Toro'
      : 'Terms and conditions | Toro';
  }, [lang]);

  return (
    <div className="min-h-screen bg-bg-surface text-text-primary">
      <header className="border-b border-border-subtle bg-bg-base">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <Link to="/" aria-label={copy.back}><BrandMark compact /></Link>
          <div className="flex items-center gap-2">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-10 sm:py-16">
        <Link to="/" className="inline-flex items-center gap-2 text-xs font-semibold text-text-muted hover:text-text-primary">
          <ArrowLeft className="size-4" /> {copy.back}
        </Link>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
          <article className="rounded-2xl border border-border-subtle bg-bg-base p-6 shadow-sm sm:p-10">
            <p className="font-mono text-[10px] tracking-[.22em] text-primary">{copy.eyebrow}</p>
            <h1 className="mt-3 text-3xl font-bold tracking-[-.035em] sm:text-5xl">{copy.title}</h1>
            <p className="mt-5 max-w-2xl text-sm leading-6 text-text-secondary">{copy.summary}</p>
            {terms && (
              <p className="mt-4 font-mono text-[10px] uppercase tracking-wider text-text-disabled">
                {copy.version}: {terms.version}-{lang}
              </p>
            )}

            <div className="mt-8 border-t border-border-subtle pt-8">
              {failed ? (
                <p className="rounded-lg border border-danger/30 bg-danger-soft p-4 text-sm text-danger">{copy.error}</p>
              ) : !terms ? (
                <p className="animate-pulse text-sm text-text-muted">{copy.loading}</p>
              ) : (
                <pre className="whitespace-pre-wrap font-sans text-[13px] leading-7 text-text-secondary">
                  {terms.texts[lang]}
                </pre>
              )}
            </div>
          </article>

          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-xl border border-primary/30 bg-primary-soft p-5">
              <ShieldAlert className="size-5 text-primary" />
              <p className="mt-3 text-sm font-bold text-text-primary">{copy.warning}</p>
              <p className="mt-3 text-xs leading-5 text-text-secondary">{copy.summary}</p>
            </div>
            <Link
              to="/dashboard/signup"
              className="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-strong"
            >
              {copy.signup} <ExternalLink className="size-4" />
            </Link>
          </aside>
        </div>
      </main>
    </div>
  );
}
