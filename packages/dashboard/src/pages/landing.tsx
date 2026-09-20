import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  Gauge,
  KeyRound,
  Repeat2,
  ShieldCheck,
  SlidersHorizontal,
  Zap,
} from 'lucide-react';
import { BrandMark } from '@/components/brand-mark';
import { LanguageToggle, useLang } from '@/i18n';
import { useAuth } from '@/lib/auth-context';
import { GRVT_REFERRAL_URL } from '@/lib/brand';

const COPY = {
  es: {
    metaTitle: 'Toro Grid Bot para GRVT | Trading automatizado',
    metaDescription:
      'Bot grid para futuros perpetuos de GRVT, con grillas virtuales, backtesting, control de riesgo y monitoreo en tiempo real.',
    nav: { how: 'Cómo funciona', control: 'Control', faq: 'Preguntas' },
    signIn: 'Ingresar',
    openApp: 'Abrir dashboard',
    eyebrow: 'GRID TRADING · GRVT PERPETUALS',
    heroTitleA: 'El mercado se mueve.',
    heroTitleB: 'Tu grilla también.',
    heroBody:
      'Toro automatiza una estrategia grid sobre futuros perpetuos de GRVT: distribuye órdenes dentro de un rango, reemplaza cada fill y te deja el control del riesgo.',
    primaryCta: 'Configurar mi primera grilla',
    secondaryCta: 'Explorar cómo funciona',
    selfHosted: 'Infraestructura dedicada',
    encrypted: 'Credenciales cifradas',
    realtime: 'Datos en tiempo real',
    live: 'MOTOR ACTIVO',
    pair: 'ETH / USDT',
    mark: 'PRECIO MARK',
    buy: 'COMPRA',
    sell: 'VENTA',
    virtual: 'VIRTUAL',
    caption:
      'Solo la ventana cercana al precio vive en GRVT. Los niveles restantes esperan de forma virtual.',
    definitionTitle: '¿Qué hace un bot grid?',
    definition:
      'Un bot grid coloca compras y ventas escalonadas dentro de un rango definido. Cuando una orden se ejecuta, Toro crea su contraparte para intentar capturar la oscilación del precio.',
    notPromise: 'No predice el mercado ni garantiza rentabilidad.',
    flowEyebrow: 'EL CICLO',
    flowTitle: 'Una estrategia visible, no una caja negra.',
    flowBody:
      'Cada etapa se puede revisar antes de usar fondos reales. El bot nace pausado y solo opera cuando confirmás la configuración.',
    steps: [
      {
        n: '01',
        title: 'Definís el terreno',
        body: 'Elegí par, dirección, rango, capital, leverage y cantidad de niveles. El preview calcula spacing, tamaño y liquidación estimada.',
      },
      {
        n: '02',
        title: 'Toro construye la grilla',
        body: 'El motor coloca órdenes límite alrededor del precio. Con grillas virtuales podés diseñar hasta 500 niveles sin superar el límite de órdenes activas.',
      },
      {
        n: '03',
        title: 'Cada fill activa el siguiente',
        body: 'Una compra ejecutada prepara una venta; una venta prepara una compra. Dashboard y WebSocket muestran posición, PnL, fills y equity.',
      },
    ],
    controlEyebrow: 'CONTROL ANTES QUE AUTOMATIZACIÓN',
    controlTitle: 'Los frenos están en la cabina.',
    controlBody:
      'Automatizar no elimina el riesgo. Toro pone las decisiones críticas a la vista y separa pausar, detener y cerrar para evitar acciones ambiguas.',
    controls: [
      ['Stop-loss y take-profit', 'Umbrales sobre el capital invertido.'],
      ['Safeguard de liquidación', 'Pausa o cierra al acercarse al precio estimado.'],
      ['Auto-shift', 'Recentra el rango cuando el mercado lo abandona.'],
      ['Backtest', 'Simula velas históricas incluyendo fees.'],
    ],
    openTitle: 'Tus claves. Tu estrategia. Tus reglas.',
    openBody:
      'Las credenciales GRVT se cifran con AES-256-GCM y se descifran en memoria únicamente al firmar operaciones.',
    source: 'Seguridad por diseño',
    architecture: ['Motor + REST', 'WebSocket', 'PostgreSQL', 'Telegram opcional'],
    dashboardEyebrow: 'UNA SOLA SUPERFICIE',
    dashboardTitle: 'Del rango a la ejecución, sin perder contexto.',
    dashboardBody:
      'Configurá, validá, ejecutá y monitoreá desde el mismo flujo. Las confirmaciones indican exactamente qué órdenes o posiciones se modificarán.',
    snapshot: {
      equity: 'Equity',
      pnl: 'PnL total',
      trades: 'Round trips',
      status: 'CORRIENDO',
      range: 'Rango activo',
      orders: 'Órdenes activas',
    },
    faqEyebrow: 'RESPUESTAS DIRECTAS',
    faqTitle: 'Preguntas frecuentes',
    faqs: [
      {
        q: '¿Toro opera con dinero real?',
        a: 'Sí, cuando conectás tus credenciales y arrancás un bot. Cada bot se crea pausado para que revises la configuración antes de colocar órdenes reales.',
      },
      {
        q: '¿Qué son las grillas virtuales?',
        a: 'Permiten definir hasta 500 niveles conceptuales. Toro mantiene activas en GRVT solo las órdenes cercanas al precio y rota esa ventana a medida que el mercado se mueve.',
      },
      {
        q: '¿Dónde se guardan las credenciales de GRVT?',
        a: 'En tu base de datos, cifradas con AES-256-GCM. La clave privada no se almacena en texto plano y solo se descifra en memoria cuando es necesaria.',
      },
      {
        q: '¿Un grid bot garantiza ganancias?',
        a: 'No. Puede perder dinero por tendencias fuertes, apalancamiento, liquidación, funding, fees o una configuración inadecuada. El backtest tampoco garantiza resultados futuros.',
      },
      {
        q: '¿Puedo usar Toro en inglés?',
        a: 'Sí. La landing, autenticación y dashboard están disponibles en español e inglés desde el selector de idioma.',
      },
    ],
    finalTitle: 'Diseñá la grilla. Revisá el riesgo. Recién después, activala.',
    finalBody: 'Creá una cuenta, conectá GRVT y configurá tu primer bot en modo pausado.',
    finalCta: 'Empezar con Toro',
    grvtCta: 'Todavía no tengo GRVT',
    risk:
      'Trading de futuros perpetuos implica riesgo de pérdida y liquidación. Toro es software de automatización, no asesoramiento financiero.',
    updated: 'Última actualización: 20 de septiembre de 2026',
    footerTag: 'Grid trading con control humano.',
    terms: 'Términos y condiciones',
  },
  en: {
    metaTitle: 'Toro Grid Bot for GRVT | Automated Trading',
    metaDescription:
      'Grid bot for GRVT perpetual futures, with virtual grids, backtesting, risk controls, and real-time monitoring.',
    nav: { how: 'How it works', control: 'Control', faq: 'Questions' },
    signIn: 'Sign in',
    openApp: 'Open dashboard',
    eyebrow: 'GRID TRADING · GRVT PERPETUALS',
    heroTitleA: 'The market moves.',
    heroTitleB: 'So does your grid.',
    heroBody:
      'Toro automates a grid strategy on GRVT perpetual futures: it distributes orders inside a range, replaces every fill, and keeps risk controls within reach.',
    primaryCta: 'Configure my first grid',
    secondaryCta: 'See how it works',
    selfHosted: 'Dedicated infrastructure',
    encrypted: 'Encrypted credentials',
    realtime: 'Real-time data',
    live: 'ENGINE LIVE',
    pair: 'ETH / USDT',
    mark: 'MARK PRICE',
    buy: 'BUY',
    sell: 'SELL',
    virtual: 'VIRTUAL',
    caption:
      'Only the window closest to price lives on GRVT. The remaining levels wait virtually.',
    definitionTitle: 'What does a grid bot do?',
    definition:
      'A grid bot places staggered buys and sells inside a defined range. When an order fills, Toro creates its counterpart to try to capture price oscillation.',
    notPromise: 'It does not predict the market or guarantee returns.',
    flowEyebrow: 'THE CYCLE',
    flowTitle: 'A visible strategy, not a black box.',
    flowBody:
      'Every stage can be reviewed before using real funds. The bot starts paused and only trades after you confirm the setup.',
    steps: [
      {
        n: '01',
        title: 'Define the terrain',
        body: 'Choose pair, direction, range, capital, leverage, and level count. The preview calculates spacing, size, and estimated liquidation.',
      },
      {
        n: '02',
        title: 'Toro builds the grid',
        body: 'The engine places limit orders around price. Virtual grids let you design up to 500 levels without exceeding the active-order cap.',
      },
      {
        n: '03',
        title: 'Every fill triggers the next',
        body: 'A filled buy prepares a sell; a filled sell prepares a buy. Dashboard and WebSocket expose position, PnL, fills, and equity.',
      },
    ],
    controlEyebrow: 'CONTROL BEFORE AUTOMATION',
    controlTitle: 'The brakes stay in the cockpit.',
    controlBody:
      'Automation does not remove risk. Toro keeps critical decisions visible and separates pause, stop, and close to prevent ambiguous actions.',
    controls: [
      ['Stop-loss and take-profit', 'Thresholds based on invested capital.'],
      ['Liquidation safeguard', 'Pause or close near estimated liquidation.'],
      ['Auto-shift', 'Recenter the range when price leaves it.'],
      ['Backtest', 'Simulate historical candles including fees.'],
    ],
    openTitle: 'Your keys. Your strategy. Your rules.',
    openBody:
      'GRVT credentials use AES-256-GCM encryption and are decrypted in memory only when signing operations.',
    source: 'Security by design',
    architecture: ['Engine + REST', 'WebSocket', 'PostgreSQL', 'Optional Telegram'],
    dashboardEyebrow: 'ONE OPERATING SURFACE',
    dashboardTitle: 'From range to execution, without losing context.',
    dashboardBody:
      'Configure, validate, execute, and monitor in one flow. Confirmations spell out exactly which orders or positions will change.',
    snapshot: {
      equity: 'Equity',
      pnl: 'Total PnL',
      trades: 'Round trips',
      status: 'RUNNING',
      range: 'Active range',
      orders: 'Active orders',
    },
    faqEyebrow: 'DIRECT ANSWERS',
    faqTitle: 'Frequently asked questions',
    faqs: [
      {
        q: 'Does Toro trade with real money?',
        a: 'Yes, after you connect credentials and start a bot. Every bot is created paused so you can review the setup before any real orders are placed.',
      },
      {
        q: 'What are virtual grids?',
        a: 'They let you define up to 500 conceptual levels. Toro keeps only the orders closest to price active on GRVT and rotates that window as the market moves.',
      },
      {
        q: 'Where are GRVT credentials stored?',
        a: 'In your database, encrypted with AES-256-GCM. The private key is never stored as plaintext and is only decrypted in memory when needed.',
      },
      {
        q: 'Does a grid bot guarantee profits?',
        a: 'No. Strong trends, leverage, liquidation, funding, fees, or poor configuration can cause losses. Backtest results do not guarantee future performance.',
      },
      {
        q: 'Can I use Toro in Spanish?',
        a: 'Yes. The landing page, authentication, and dashboard are available in English and Spanish from the language selector.',
      },
    ],
    finalTitle: 'Design the grid. Review the risk. Only then, switch it on.',
    finalBody: 'Create an account, connect GRVT, and configure your first bot in paused mode.',
    finalCta: 'Start with Toro',
    grvtCta: 'I do not have GRVT yet',
    risk:
      'Perpetual futures trading involves risk of loss and liquidation. Toro is automation software, not financial advice.',
    updated: 'Last updated: September 20, 2026',
    footerTag: 'Grid trading with human control.',
    terms: 'Terms and conditions',
  },
} as const;

function GridInstrument({
  copy,
}: {
  copy: (typeof COPY)[keyof typeof COPY];
}) {
  const levels = [
    { value: '3,712.40', side: 'sell', width: '72%' },
    { value: '3,668.80', side: 'sell', width: '61%' },
    { value: '3,625.20', side: 'sell', width: '49%' },
    { value: '3,581.60', side: 'mark', width: '84%' },
    { value: '3,538.00', side: 'buy', width: '55%' },
    { value: '3,494.40', side: 'buy', width: '66%' },
    { value: '3,450.80', side: 'virtual', width: '42%' },
  ];

  return (
    <div className="relative border border-border-default bg-[#100e0b] shadow-[0_28px_90px_rgba(0,0,0,.55)]">
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
        <div>
          <div className="font-mono text-[10px] tracking-[.18em] text-text-muted">{copy.pair}</div>
          <div className="mt-1 font-mono text-lg text-text-primary">$3,581.60</div>
        </div>
        <div className="flex items-center gap-2 font-mono text-[9px] tracking-[.14em] text-success">
          <span className="size-1.5 rounded-full bg-success shadow-[0_0_10px_var(--color-success)]" />
          {copy.live}
        </div>
      </div>

      <div className="relative px-4 py-5">
        <div className="absolute bottom-5 left-[7.6rem] top-5 w-px bg-border-subtle" />
        <div className="space-y-3">
          {levels.map((level, i) => (
            <div key={level.value} className="grid grid-cols-[6.4rem_1fr_4rem] items-center gap-3">
              <span className="font-mono text-[10px] text-text-muted">{level.value}</span>
              <span
                className={`relative block h-px ${
                  level.side === 'sell'
                    ? 'bg-danger'
                    : level.side === 'buy'
                      ? 'bg-success'
                      : level.side === 'mark'
                        ? 'bg-primary'
                        : 'border-t border-dashed border-border-strong'
                }`}
                style={{ width: level.width }}
              >
                {level.side === 'mark' && (
                  <span className="absolute -right-1 -top-1 size-2 rounded-full bg-primary shadow-[0_0_14px_var(--color-primary)]" />
                )}
              </span>
              <span
                className={`font-mono text-right text-[9px] tracking-wider ${
                  level.side === 'sell'
                    ? 'text-danger'
                    : level.side === 'buy'
                      ? 'text-success'
                      : level.side === 'mark'
                        ? 'text-primary'
                        : 'text-text-disabled'
                }`}
              >
                {level.side === 'sell'
                  ? copy.sell
                  : level.side === 'buy'
                    ? copy.buy
                    : level.side === 'mark'
                      ? copy.mark
                      : copy.virtual}
              </span>
              {i < levels.length - 1 && (
                <span className="col-start-2 -my-1 ml-3 block h-1 w-px bg-border-default" />
              )}
            </div>
          ))}
        </div>
      </div>
      <p className="border-t border-border-subtle px-4 py-3 text-[11px] leading-relaxed text-text-muted">
        {copy.caption}
      </p>
    </div>
  );
}

export function LandingPage() {
  const { lang } = useLang();
  const { token } = useAuth();
  const copy = COPY[lang];
  const appTarget = token ? '/dashboard' : '/dashboard/signup';

  const structuredData = useMemo(
    () => ({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'SoftwareApplication',
          name: 'Toro',
          applicationCategory: 'FinanceApplication',
          operatingSystem: 'Web, Linux, Docker',
          description: copy.metaDescription,
          url: typeof window === 'undefined' ? '/' : window.location.origin,
          author: {
            '@type': 'Person',
            name: 'LauElToro',
          },
          dateModified: '2026-09-20',
          inLanguage: lang,
          isAccessibleForFree: true,
        },
        {
          '@type': 'FAQPage',
          mainEntity: copy.faqs.map((item) => ({
            '@type': 'Question',
            name: item.q,
            acceptedAnswer: { '@type': 'Answer', text: item.a },
          })),
        },
      ],
    }),
    [copy, lang]
  );

  useEffect(() => {
    document.title = copy.metaTitle;
    const upsertMeta = (selector: string, attrs: Record<string, string>) => {
      let node = document.head.querySelector<HTMLMetaElement>(selector);
      if (!node) {
        node = document.createElement('meta');
        document.head.appendChild(node);
      }
      Object.entries(attrs).forEach(([key, value]) => node?.setAttribute(key, value));
    };
    upsertMeta('meta[name="description"]', { name: 'description', content: copy.metaDescription });
    upsertMeta('meta[property="og:title"]', { property: 'og:title', content: copy.metaTitle });
    upsertMeta('meta[property="og:description"]', {
      property: 'og:description',
      content: copy.metaDescription,
    });
    upsertMeta('meta[property="og:type"]', { property: 'og:type', content: 'website' });

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = window.location.origin + '/';

    let schema = document.head.querySelector<HTMLScriptElement>('#toro-structured-data');
    if (!schema) {
      schema = document.createElement('script');
      schema.id = 'toro-structured-data';
      schema.type = 'application/ld+json';
      document.head.appendChild(schema);
    }
    schema.textContent = JSON.stringify(structuredData);

    return () => {
      document.title = 'Toro';
      document.head.querySelector('#toro-structured-data')?.remove();
      document.head.querySelector('link[rel="canonical"]')?.remove();
    };
  }, [copy, structuredData]);

  return (
    <div className="min-h-dvh overflow-x-hidden bg-bg-base text-text-primary selection:bg-primary selection:text-bg-base">
      <header className="sticky top-0 z-50 border-b border-border-subtle bg-bg-base/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center px-5 lg:px-8">
          <a href="#top" aria-label="Toro home">
            <BrandMark compact />
          </a>
          <nav aria-label="Landing navigation" className="ml-auto hidden items-center gap-7 md:flex">
            <a href="#como-funciona" className="text-xs text-text-muted transition-colors hover:text-text-primary">
              {copy.nav.how}
            </a>
            <a href="#control" className="text-xs text-text-muted transition-colors hover:text-text-primary">
              {copy.nav.control}
            </a>
            <a href="#preguntas" className="text-xs text-text-muted transition-colors hover:text-text-primary">
              {copy.nav.faq}
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-2 md:ml-8">
            <LanguageToggle variant="compact" />
            <Link
              to={token ? '/dashboard' : '/dashboard/login'}
              className="hidden border border-border-default px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-primary hover:text-primary sm:inline-flex"
            >
              {token ? copy.openApp : copy.signIn}
            </Link>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="relative border-b border-border-subtle">
          <div className="pointer-events-none absolute inset-0 opacity-[.055] [background-image:linear-gradient(var(--color-text-primary)_1px,transparent_1px),linear-gradient(90deg,var(--color-text-primary)_1px,transparent_1px)] [background-size:48px_48px]" />
          <div className="relative mx-auto grid max-w-7xl gap-14 px-5 py-16 sm:py-24 lg:grid-cols-[1.08fr_.92fr] lg:items-center lg:px-8 lg:py-28">
            <div>
              <p className="mb-7 font-mono text-[10px] tracking-[.23em] text-primary">{copy.eyebrow}</p>
              <h1 className="max-w-3xl text-[clamp(3.2rem,8vw,6.8rem)] font-semibold leading-[.84] tracking-[-.065em]">
                <span className="block">{copy.heroTitleA}</span>
                <span className="mt-3 block text-primary">{copy.heroTitleB}</span>
              </h1>
              <p className="mt-8 max-w-xl text-base leading-7 text-text-secondary sm:text-lg">{copy.heroBody}</p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  to={appTarget}
                  className="group inline-flex min-h-12 items-center justify-center gap-3 bg-primary px-5 text-sm font-semibold text-bg-base transition-colors hover:bg-primary-strong"
                >
                  {copy.primaryCta}
                  <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </Link>
                <a
                  href="#como-funciona"
                  className="inline-flex min-h-12 items-center justify-center gap-3 border border-border-default px-5 text-sm font-medium text-text-secondary transition-colors hover:border-text-muted hover:text-text-primary"
                >
                  {copy.secondaryCta}
                  <ArrowDown className="size-4" />
                </a>
              </div>
              <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 font-mono text-[10px] tracking-wide text-text-muted">
                {[copy.selfHosted, copy.encrypted, copy.realtime].map((item) => (
                  <span key={item} className="flex items-center gap-2">
                    <Check className="size-3 text-success" />
                    {item}
                  </span>
                ))}
              </div>
            </div>
            <div className="relative mx-auto w-full max-w-lg lg:mx-0 lg:ml-auto">
              <div className="absolute -left-6 -top-6 size-20 border-l border-t border-primary/50" />
              <div className="absolute -bottom-6 -right-6 size-20 border-b border-r border-primary/50" />
              <GridInstrument copy={copy} />
            </div>
          </div>
        </section>

        <section className="border-b border-border-subtle bg-bg-surface">
          <div className="mx-auto grid max-w-7xl md:grid-cols-[.42fr_1fr]">
            <div className="border-b border-border-subtle px-5 py-7 md:border-b-0 md:border-r lg:px-8">
              <h2 className="font-mono text-xs tracking-[.16em] text-primary">{copy.definitionTitle}</h2>
            </div>
            <div className="px-5 py-7 lg:px-10">
              <p className="max-w-4xl text-lg leading-8 text-text-primary">
                {copy.definition}{' '}
                <strong className="font-medium text-warning">{copy.notPromise}</strong>
              </p>
            </div>
          </div>
        </section>

        <section id="como-funciona" className="scroll-mt-20 border-b border-border-subtle py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-5 lg:px-8">
            <div className="grid gap-7 lg:grid-cols-2">
              <div>
                <p className="font-mono text-[10px] tracking-[.2em] text-primary">{copy.flowEyebrow}</p>
                <h2 className="mt-4 max-w-xl text-4xl font-semibold leading-tight tracking-[-.035em] sm:text-5xl">
                  {copy.flowTitle}
                </h2>
              </div>
              <p className="max-w-xl self-end text-base leading-7 text-text-secondary">{copy.flowBody}</p>
            </div>
            <ol className="mt-14 border-t border-border-default">
              {copy.steps.map((step, index) => (
                <li
                  key={step.n}
                  className="group grid gap-4 border-b border-border-subtle py-7 transition-colors hover:bg-bg-surface md:grid-cols-[6rem_.7fr_1fr] md:items-start md:px-5"
                >
                  <span className="font-mono text-xs text-primary">{step.n}</span>
                  <h3 className="text-xl font-medium tracking-tight">{step.title}</h3>
                  <p className="max-w-xl text-sm leading-6 text-text-muted">{step.body}</p>
                  {index < copy.steps.length - 1 && (
                    <span className="sr-only">{' → '}</span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="control" className="scroll-mt-20 border-b border-border-subtle bg-[#0a1510]">
          <div className="mx-auto grid max-w-7xl lg:grid-cols-2">
            <div className="px-5 py-20 lg:border-r lg:border-white/10 lg:px-8 lg:py-28">
              <p className="font-mono text-[10px] tracking-[.2em] text-success">{copy.controlEyebrow}</p>
              <h2 className="mt-4 max-w-xl text-4xl font-semibold leading-tight tracking-[-.035em] sm:text-5xl">
                {copy.controlTitle}
              </h2>
              <p className="mt-6 max-w-xl text-base leading-7 text-[#a9b9ae]">{copy.controlBody}</p>
              <div className="mt-10 grid gap-px border border-white/10 bg-white/10 sm:grid-cols-2">
                {copy.controls.map(([title, body], index) => {
                  const Icon = [ShieldCheck, Gauge, Repeat2, BarChart3][index];
                  return (
                    <div key={title} className="bg-[#0a1510] p-5">
                      <Icon className="size-5 text-success" />
                      <h3 className="mt-5 text-sm font-medium text-[#edf5ef]">{title}</h3>
                      <p className="mt-2 text-xs leading-5 text-[#809488]">{body}</p>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-col justify-between border-t border-white/10 px-5 py-20 lg:border-t-0 lg:px-12 lg:py-28">
              <div>
                <KeyRound className="size-8 text-primary" strokeWidth={1.5} />
                <h2 className="mt-8 max-w-lg text-3xl font-semibold tracking-[-.03em] sm:text-4xl">{copy.openTitle}</h2>
                <p className="mt-5 max-w-lg text-base leading-7 text-[#a9b9ae]">{copy.openBody}</p>
                <div className="mt-8 inline-flex items-center gap-3 text-sm font-medium text-primary">
                  <ShieldCheck className="size-4" />
                  {copy.source}
                </div>
              </div>
              <div className="mt-14 flex flex-wrap gap-2">
                {copy.architecture.map((item) => (
                  <span key={item} className="border border-white/10 px-3 py-2 font-mono text-[9px] tracking-wider text-[#809488]">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-border-subtle py-20 sm:py-28">
          <div className="mx-auto grid max-w-7xl gap-14 px-5 lg:grid-cols-[.8fr_1.2fr] lg:items-center lg:px-8">
            <div>
              <p className="font-mono text-[10px] tracking-[.2em] text-primary">{copy.dashboardEyebrow}</p>
              <h2 className="mt-4 text-4xl font-semibold leading-tight tracking-[-.035em] sm:text-5xl">{copy.dashboardTitle}</h2>
              <p className="mt-6 text-base leading-7 text-text-secondary">{copy.dashboardBody}</p>
            </div>
            <div className="border border-border-default bg-bg-surface p-1.5">
              <div className="border border-border-subtle bg-bg-base">
                <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-success" />
                    <span className="font-mono text-[10px] tracking-wider text-success">{copy.snapshot.status}</span>
                  </div>
                  <span className="font-mono text-xs">ETH_USDT_Perp</span>
                </div>
                <div className="grid grid-cols-3 border-b border-border-subtle">
                  {[
                    [copy.snapshot.equity, '$10,842.16'],
                    [copy.snapshot.pnl, '+$842.16'],
                    [copy.snapshot.trades, '126'],
                  ].map(([label, value], index) => (
                    <div key={label} className={`p-4 ${index < 2 ? 'border-r border-border-subtle' : ''}`}>
                      <div className="text-[10px] text-text-muted">{label}</div>
                      <div className={`mt-2 font-mono text-base ${index === 1 ? 'text-success' : ''}`}>{value}</div>
                    </div>
                  ))}
                </div>
                <div className="grid min-h-48 grid-cols-[1fr_6rem]">
                  <div className="relative overflow-hidden border-r border-border-subtle p-5">
                    <div className="absolute inset-x-5 bottom-9 top-7 border-y border-dashed border-border-default" />
                    <svg viewBox="0 0 500 150" className="relative h-full w-full" role="img" aria-label="Sample equity curve">
                      <path
                        d="M0 120 C35 112,48 130,76 104 S120 82,148 95 S190 74,220 78 S260 44,294 63 S340 47,370 50 S420 22,500 28"
                        fill="none"
                        stroke="var(--color-primary)"
                        strokeWidth="3"
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                  </div>
                  <div className="flex flex-col justify-center gap-5 p-3">
                    <div>
                      <div className="text-[9px] text-text-disabled">{copy.snapshot.range}</div>
                      <div className="mt-1 font-mono text-[10px]">3,200—3,900</div>
                    </div>
                    <div>
                      <div className="text-[9px] text-text-disabled">{copy.snapshot.orders}</div>
                      <div className="mt-1 font-mono text-[10px]">48 / 80</div>
                    </div>
                    <SlidersHorizontal className="size-4 text-primary" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="preguntas" className="scroll-mt-20 border-b border-border-subtle py-20 sm:py-28">
          <div className="mx-auto grid max-w-7xl gap-12 px-5 lg:grid-cols-[.65fr_1.35fr] lg:px-8">
            <div>
              <p className="font-mono text-[10px] tracking-[.2em] text-primary">{copy.faqEyebrow}</p>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-.035em] sm:text-5xl">{copy.faqTitle}</h2>
            </div>
            <div className="border-t border-border-default">
              {copy.faqs.map((faq, index) => (
                <details key={faq.q} className="group border-b border-border-subtle">
                  <summary className="flex cursor-pointer list-none items-center gap-5 py-6 text-left">
                    <span className="font-mono text-[10px] text-text-disabled">0{index + 1}</span>
                    <h3 className="flex-1 text-base font-medium">{faq.q}</h3>
                    <span className="grid size-7 place-items-center border border-border-default text-primary transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="pb-6 pl-10 pr-12 text-sm leading-6 text-text-muted">{faq.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden bg-primary text-bg-base">
          <div className="absolute -right-16 -top-28 text-[22rem] font-bold leading-none text-black/[.06]" aria-hidden="true">T</div>
          <div className="relative mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-24">
            <Zap className="size-7" />
            <h2 className="mt-7 max-w-4xl text-4xl font-semibold leading-[1.05] tracking-[-.045em] sm:text-6xl">{copy.finalTitle}</h2>
            <p className="mt-6 max-w-2xl text-base text-bg-base/75">{copy.finalBody}</p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link to={appTarget} className="inline-flex min-h-12 items-center justify-center gap-3 bg-bg-base px-5 text-sm font-semibold text-primary">
                {copy.finalCta}
                <ArrowRight className="size-4" />
              </Link>
              <a
                href={GRVT_REFERRAL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-12 items-center justify-center gap-3 border border-bg-base/30 px-5 text-sm font-medium hover:bg-black/10"
              >
                {copy.grvtCta}
                <ArrowUpRight className="size-4" />
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#080705]">
        <div className="mx-auto max-w-7xl px-5 py-10 lg:px-8">
          <div className="flex flex-col gap-7 border-b border-border-subtle pb-8 sm:flex-row sm:items-center sm:justify-between">
            <BrandMark compact />
            <p className="text-xs text-text-muted">{copy.footerTag}</p>
            <Link to="/terms" className="text-xs text-text-muted underline-offset-4 hover:text-primary hover:underline">
              {copy.terms}
            </Link>
            <span className="text-xs text-text-muted">© 2026 Toro</span>
          </div>
          <div className="mt-7 flex flex-col gap-3 text-[10px] leading-5 text-text-disabled sm:flex-row sm:items-end sm:justify-between">
            <p className="max-w-2xl">{copy.risk}</p>
            <time dateTime="2026-09-20">{copy.updated}</time>
          </div>
        </div>
      </footer>
    </div>
  );
}
