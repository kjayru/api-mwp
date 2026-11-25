// Allowlists and defaults of the assistant configuration (AssistantSettings).
// Plain constants only: the seed imports this file with Node's type stripping.

/** Models the admin may choose. Sonnet 5.5 is the team's choice for the chat. */
export const ASSISTANT_MODELS = [
  'claude-sonnet-5-5',
  'claude-opus-5-5',
  'claude-haiku-4-5',
] as const;
export type AssistantModel = (typeof ASSISTANT_MODELS)[number];

/** "Nivel de esfuerzo" (Bajo / Medio / Alto) -> output_config.effort. */
export const ASSISTANT_EFFORTS = ['low', 'medium', 'high'] as const;
export type AssistantEffort = (typeof ASSISTANT_EFFORTS)[number];

/** Tools of the chat, in the (stable) order they are sent to the model. */
export const ASSISTANT_TOOLS = [
  'buscar_casos',
  'crear_lead',
  'agendar_reunion',
] as const;
export type AssistantToolName = (typeof ASSISTANT_TOOLS)[number];

export const MAX_MESSAGES_PER_SESSION_MIN = 1;
export const MAX_MESSAGES_PER_SESSION_MAX = 100;
export const INSTRUCTIONS_MAX_LENGTH = 8000;

export const DEFAULT_ASSISTANT_MODEL: AssistantModel = 'claude-sonnet-5-5';
export const DEFAULT_ASSISTANT_EFFORT: AssistantEffort = 'low';
export const DEFAULT_MAX_MESSAGES_PER_SESSION = 20;

/** Editable from the admin ("Instrucciones"); the fixed rules are added by the API. */
export const DEFAULT_ASSISTANT_INSTRUCTIONS = [
  'Eres el asistente de miwebprofesional, un estudio de desarrollo de software de Lima (Perú) que crea plataformas SaaS, ecommerce, webs con CMS, herramientas a medida e integraciones con IA.',
  'Tu objetivo es ayudar a los visitantes del sitio a conocer los proyectos que el estudio ha realizado y cómo trabaja, y, si les interesa, ponerlos en contacto con el equipo.',
  'Responde solo con información de la base de conocimiento (casos publicados y preguntas frecuentes) y cita los casos en los que te basas. Si no estás seguro o no encuentras la respuesta, dilo con honestidad y ofrece hablar con el equipo.',
  'Sé cercano, claro y profesional, con respuestas breves. Responde en el idioma del visitante.',
].join('\n\n');
