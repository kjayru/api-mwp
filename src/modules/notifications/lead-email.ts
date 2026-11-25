import type { LeadSource, Locale } from '../../generated/prisma/enums.js';

/** The lead fields that go into the notification. */
export interface LeadEmailData {
  id: string;
  source: LeadSource;
  name: string;
  email: string;
  phone: string | null;
  interest: string | null;
  message: string | null;
  locale: Locale;
}

export const SOURCE_LABELS: Record<LeadSource, string> = {
  FORM: 'Formulario de contacto',
  CHAT_IA: 'Asistente IA',
};

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/** Header-safe single line (no CR/LF), at most `max` characters. */
function oneLine(value: string, max: number): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Subject, plain text and simple HTML (in Spanish) of the new-lead email. */
export function buildLeadEmail(
  lead: LeadEmailData,
  adminUrl: string,
): { subject: string; text: string; html: string } {
  const link = `${adminUrl}/leads/${encodeURIComponent(lead.id)}`;
  const source = SOURCE_LABELS[lead.source];
  const bodyLabel = lead.source === 'CHAT_IA' ? 'Resumen' : 'Mensaje';
  const fields: [string, string][] = [
    ['Nombre', lead.name],
    ['Email', lead.email],
    ['Teléfono', lead.phone || '—'],
    ['Origen', source],
    ['Interés', lead.interest || '—'],
    ['Idioma', lead.locale],
  ];
  const message = lead.message?.trim() || '—';

  const text = [
    `Nuevo lead desde ${source}.`,
    '',
    ...fields.map(([label, value]) => `${label}: ${value}`),
    '',
    `${bodyLabel}:`,
    message,
    '',
    `Ver en el panel: ${link}`,
  ].join('\n');

  const rows = fields
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#555"><strong>${escapeHtml(label)}</strong></td><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`,
    )
    .join('');
  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111">',
    `<p>Nuevo lead desde <strong>${escapeHtml(source)}</strong>.</p>`,
    `<table style="border-collapse:collapse">${rows}</table>`,
    `<p style="margin-top:16px"><strong>${bodyLabel}:</strong></p>`,
    `<p style="white-space:pre-wrap">${escapeHtml(message)}</p>`,
    `<p style="margin-top:16px"><a href="${escapeHtml(link)}">Ver el lead en el panel</a></p>`,
    '</div>',
  ].join('\n');

  return {
    subject: oneLine(`Nuevo lead (${source}): ${lead.name}`, 200),
    text,
    html,
  };
}
