// Plantilla transaccional de Toro. Negro #0a0a0a, blanco #ffffff, rojo #dc2626.
// La misma estructura vive en packages/notifier/src/email-layout.ts.

export interface EmailFact {
  label: string;
  value: string;
  accent?: boolean;
}

export interface EmailTable {
  headers: string[];
  rows: string[][];
}

export interface EmailDocument {
  lang: 'es' | 'en';
  preheader: string;
  heading: string;
  paragraphs: string[];
  code?: string;
  facts?: EmailFact[];
  table?: EmailTable;
  notes?: string[];
  cta?: { label: string; href: string };
  footer: string;
}

export interface OutboundEmail {
  subject: string;
  text: string;
  html: string;
}

const BLACK = '#0a0a0a';
const WHITE = '#ffffff';
const RED = '#dc2626';

export function composeEmail(subject: string, doc: EmailDocument): OutboundEmail {
  const rendered = renderEmail(doc);
  return { subject, text: rendered.text, html: rendered.html };
}

export function renderEmail(doc: EmailDocument): { text: string; html: string } {
  const paragraphs = doc.paragraphs.map((line) => line.trim()).filter(Boolean);
  const notes = (doc.notes ?? []).map((line) => line.trim()).filter(Boolean);
  const facts = (doc.facts ?? []).filter((fact) => fact.label && fact.value);
  const table = doc.table && doc.table.rows.length > 0 ? doc.table : undefined;
  const href = doc.cta ? safeHttpUrl(doc.cta.href) : null;

  const textBlocks: string[] = ['TORO', '', doc.heading, ''];
  if (doc.preheader) textBlocks.push(doc.preheader, '');
  for (const paragraph of paragraphs) textBlocks.push(paragraph, '');
  if (doc.code) {
    const codeLabel = doc.lang === 'en' ? 'Code' : 'Código';
    textBlocks.push(`${codeLabel}: ${doc.code}`, '');
  }
  if (facts.length > 0) {
    textBlocks.push(...facts.map((fact) => `${fact.label}: ${fact.value}`), '');
  }
  if (table) {
    textBlocks.push(table.headers.join(' | '));
    for (const row of table.rows) textBlocks.push(row.join(' | '));
    textBlocks.push('');
  }
  for (const note of notes) textBlocks.push(note, '');
  if (doc.cta) {
    textBlocks.push(doc.cta.label);
    textBlocks.push(doc.cta.href, '');
  }
  textBlocks.push('—', doc.footer);

  const html = [
    '<!DOCTYPE html>',
    `<html lang="${doc.lang === 'en' ? 'en' : 'es'}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(doc.heading)}</title>`,
    '</head>',
    `<body style="margin:0;padding:0;background:${WHITE};">`,
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(doc.preheader)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${WHITE};border-collapse:collapse;">`,
    '<tr><td align="center" style="padding:24px 12px;">',
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;border:1px solid ${BLACK};border-collapse:collapse;background:${WHITE};">`,
    `<tr><td style="background:${BLACK};padding:22px 28px;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:700;letter-spacing:3px;color:${WHITE};">TORO</td></tr>`,
    `<tr><td style="background:${RED};height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>`,
    `<tr><td style="padding:28px 28px 8px;font-family:Arial,Helvetica,sans-serif;color:${BLACK};">`,
    `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.35;font-weight:700;color:${BLACK};">${escapeHtml(doc.heading)}</h1>`,
    ...paragraphs.map((paragraph) =>
      `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${BLACK};">${escapeHtml(paragraph)}</p>`
    ),
    doc.code
      ? `<p style="margin:8px 0 20px;padding:18px 12px;border:2px solid ${RED};text-align:center;font-family:Consolas,Courier,monospace;font-size:32px;line-height:1.2;font-weight:700;letter-spacing:8px;color:${RED};">${escapeHtml(doc.code)}</p>`
      : '',
    facts.length > 0 ? renderFacts(facts) : '',
    table ? renderTable(table) : '',
    ...notes.map((note) =>
      `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:${BLACK};">${escapeHtml(note)}</p>`
    ),
    doc.cta && href ? renderCta(doc.cta.label, href) : '',
    '</td></tr>',
    `<tr><td style="padding:16px 28px 24px;border-top:1px solid ${BLACK};font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.55;color:${BLACK};">${escapeHtml(doc.footer)}</td></tr>`,
    '</table>',
    '</td></tr></table>',
    '</body></html>',
  ].join('');

  return {
    text: textBlocks.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n',
    html,
  };
}

function renderFacts(facts: EmailFact[]): string {
  const rows = facts.map((fact) => {
    const valueColor = fact.accent ? RED : BLACK;
    return (
      '<tr>' +
      `<td style="padding:8px 12px;border-bottom:1px solid ${BLACK};font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.4;color:${BLACK};vertical-align:top;width:46%;">${escapeHtml(fact.label)}</td>` +
      `<td style="padding:8px 12px;border-bottom:1px solid ${BLACK};font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.4;font-weight:700;color:${valueColor};vertical-align:top;">${escapeHtml(fact.value)}</td>` +
      '</tr>'
    );
  });
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;border-collapse:collapse;border-top:1px solid ${BLACK};">` +
    rows.join('') +
    '</table>'
  );
}

function renderTable(table: EmailTable): string {
  const header = table.headers.map((cell) =>
    `<th align="left" style="padding:8px 10px;background:${BLACK};color:${WHITE};font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;">${escapeHtml(cell)}</th>`
  ).join('');
  const body = table.rows.map((row) =>
    '<tr>' + row.map((cell) =>
      `<td style="padding:8px 10px;border-bottom:1px solid ${BLACK};font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.4;color:${BLACK};">${escapeHtml(cell)}</td>`
    ).join('') + '</tr>'
  ).join('');
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-collapse:collapse;">` +
    `<tr>${header}</tr>${body}</table>`
  );
}

function renderCta(label: string, href: string): string {
  return (
    `<p style="margin:8px 0 18px;">` +
    `<a href="${escapeHtml(href)}" style="display:inline-block;background:${RED};color:${WHITE};font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;line-height:1;text-decoration:none;padding:14px 18px;">${escapeHtml(label)}</a>` +
    `</p>` +
    `<p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:${BLACK};">` +
    `<a href="${escapeHtml(href)}" style="color:${RED};word-break:break-all;">${escapeHtml(href)}</a>` +
    `</p>`
  );
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
