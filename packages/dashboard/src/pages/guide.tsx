import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { useT } from '@/i18n';

export function GuidePage() {
  const t = useT();
  const sections = [
    ['01', t('guide.s1Title'), t('guide.s1Body')],
    ['02', t('guide.s2Title'), t('guide.s2Body')],
    ['03', t('guide.s3Title'), t('guide.s3Body')],
    ['04', t('guide.s4Title'), t('guide.s4Body')],
    ['05', t('guide.s5Title'), t('guide.s5Body')],
    ['06', t('guide.s6Title'), t('guide.s6Body')],
    ['07', t('guide.s7Title'), t('guide.s7Body')],
    ['08', t('guide.s8Title'), t('guide.s8Body')],
    ['09', t('guide.s9Title'), t('guide.s9Body')],
    ['10', t('guide.s10Title'), t('guide.s10Body')],
  ] as const;

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        eyebrow={t('guide.eyebrow')}
        title={t('guide.title')}
        subtitle={t('guide.subtitle')}
      />

      <section className="border border-border-subtle bg-bg-surface p-5 sm:p-7">
        <p className="font-mono text-[10px] tracking-[.2em] text-primary">{t('guide.flowEyebrow')}</p>
        <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-[-.03em]">{t('guide.flowTitle')}</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-text-muted">{t('guide.flowBody')}</p>
      </section>

      <ol className="border-t border-border-default">
        {sections.map(([n, title, body]) => (
          <li
            key={n}
            className="grid gap-3 border-b border-border-subtle py-6 md:grid-cols-[5rem_0.7fr_1.2fr] md:items-start"
          >
            <span className="font-mono text-xs text-primary">{n}</span>
            <h3 className="text-lg font-medium tracking-tight">{title}</h3>
            <p className="max-w-xl text-sm leading-6 text-text-muted">{body}</p>
          </li>
        ))}
      </ol>

      <div className="bg-primary p-6 text-white sm:p-8">
        <h2 className="text-2xl font-semibold tracking-[-.03em]">{t('guide.finalTitle')}</h2>
        <p className="mt-3 max-w-xl text-sm text-white/80">{t('guide.finalBody')}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link
            to="/dashboard"
            className="inline-flex min-h-11 items-center justify-center gap-2 bg-white px-4 text-sm font-semibold text-primary"
          >
            {t('guide.createCta')}
            <ArrowRight className="size-4" />
          </Link>
          <Link
            to="/dashboard/podio"
            className="inline-flex min-h-11 items-center justify-center gap-2 border border-white/40 px-4 text-sm font-medium"
          >
            {t('guide.podiumCta')}
          </Link>
        </div>
      </div>
    </div>
  );
}
