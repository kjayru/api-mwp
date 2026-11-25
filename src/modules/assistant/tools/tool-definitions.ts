import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { AssistantToolName } from '../../assistant-settings/assistant-settings.constants.js';

export const CASE_TYPES = [
  'SAAS',
  'ECOMMERCE',
  'WEB_CMS',
  'TOOL',
  'PLATFORM',
] as const;

type Tool = Anthropic.Beta.Messages.BetaTool;

// Every tool is strict (the API guarantees schema-valid input) and streams
// its input eagerly; because eager streaming skips the server-side
// validation, each input is validated again with zod before it runs.
const COMMON = { strict: true, eager_input_streaming: true } as const;

export const TOOL_DEFINITIONS: Record<AssistantToolName, Tool> = {
  buscar_casos: {
    ...COMMON,
    name: 'buscar_casos',
    description:
      'Busca en la base de conocimiento del estudio (casos publicados y preguntas frecuentes) los fragmentos más relevantes para una consulta. Úsala antes de responder cualquier pregunta sobre proyectos, experiencia, tecnologías, plazos, procesos, servicios o forma de trabajo, incluso si crees saber la respuesta. Devuelve fragmentos con su id de fuente ("fuente"), que debes citar entre corchetes. Si no devuelve resultados, no hay información sobre el tema.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Lo que se busca, reformulado como una frase completa en el idioma del visitante (p. ej. "sistema para estudios contables").',
        },
        tipo: {
          type: 'string',
          enum: [...CASE_TYPES],
          description:
            'Opcional. Limita la búsqueda a casos de un tipo: SAAS, ECOMMERCE, WEB_CMS (web con CMS), TOOL (herramienta) o PLATFORM. Excluye las preguntas frecuentes.',
        },
        tecnologia: {
          type: 'string',
          description:
            'Opcional. Limita la búsqueda a casos que usan esa tecnología (nombre, p. ej. "Next.js" o "PostgreSQL"). Excluye las preguntas frecuentes.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  crear_lead: {
    ...COMMON,
    name: 'crear_lead',
    description:
      'Registra los datos de contacto del visitante para que el equipo le escriba. Úsala solo cuando el visitante haya dado al menos su nombre y su email y quiera que lo contacten. Si ya la usaste en esta conversación, vuelve a llamarla para actualizar los datos (no se duplica).',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre del visitante.' },
        email: { type: 'string', description: 'Email del visitante.' },
        telefono: {
          type: 'string',
          description: 'Opcional. Teléfono o WhatsApp, solo si lo dio.',
        },
        interes: {
          type: 'string',
          description:
            'Qué le interesa en pocas palabras (p. ej. "plataforma SaaS para clínicas").',
        },
        resumen: {
          type: 'string',
          description:
            'Resumen breve de la conversación y de lo que necesita, para el equipo.',
        },
      },
      required: ['nombre', 'email', 'interes', 'resumen'],
      additionalProperties: false,
    },
  },
  agendar_reunion: {
    ...COMMON,
    name: 'agendar_reunion',
    description:
      'Agenda una videollamada con el equipo en su horario laboral y registra al visitante como lead. Necesita nombre, email, la fecha y hora preferidas en la hora local del visitante y su zona horaria. Devuelve la reunión confirmada (con enlace de Google Meet), la solicitud registrada para que el equipo la confirme por email, o hasta 3 horarios alternativos si el elegido no está disponible.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre del visitante.' },
        email: {
          type: 'string',
          description: 'Email del visitante (recibe la invitación).',
        },
        fecha_hora_preferida: {
          type: 'string',
          description:
            'Fecha y hora de inicio en la hora local del visitante, formato AAAA-MM-DDTHH:mm (p. ej. 2026-11-26T10:30).',
        },
        zona_horaria: {
          type: 'string',
          description:
            'Zona horaria IANA del visitante (p. ej. America/Lima, America/Bogota, Europe/Madrid).',
        },
        motivo: {
          type: 'string',
          description: 'De qué quiere hablar, en una frase.',
        },
      },
      required: [
        'nombre',
        'email',
        'fecha_hora_preferida',
        'zona_horaria',
        'motivo',
      ],
      additionalProperties: false,
    },
  },
};

/** Tool list of a request, in the fixed ASSISTANT_TOOLS order (cache-stable). */
export function toolsFor(enabled: readonly AssistantToolName[]): Tool[] {
  return enabled.map((name) => TOOL_DEFINITIONS[name]);
}

const text = (max: number) => z.string().trim().min(1).max(max);

export const SearchInput = z.strictObject({
  query: text(500),
  tipo: z.enum(CASE_TYPES).optional(),
  tecnologia: text(80).optional(),
});

export const LeadInput = z.strictObject({
  nombre: text(120),
  email: z.string().trim().max(200),
  telefono: z.string().trim().max(40).optional(),
  interes: text(300),
  resumen: text(2000),
});

export const MeetingInput = z.strictObject({
  nombre: text(120),
  email: z.string().trim().max(200),
  fecha_hora_preferida: text(40),
  zona_horaria: text(64),
  motivo: text(500),
});

export type SearchInputT = z.infer<typeof SearchInput>;
export type LeadInputT = z.infer<typeof LeadInput>;
export type MeetingInputT = z.infer<typeof MeetingInput>;

const EMAIL = z.email();

export function isValidEmail(value: string): boolean {
  return EMAIL.safeParse(value).success;
}
