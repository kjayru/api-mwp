// Development / QA seed content. The real content will be managed from admin-mwp;
// until then these are SAMPLE texts and figures (the metrics are illustrative, not
// client results). Only CorteMaestro's challenge and solution come from the mockup.
import type {
  CaseType,
  Locale,
  TechnologyCategory,
} from '../src/generated/prisma/enums.js';
import type { CaseBlock } from '../src/modules/cases/entities/case-block.entity.js';

export interface TechnologySeed {
  name: string;
  slug: string;
  category: TechnologyCategory;
  isFeatured: boolean;
}

/** Order = sortOrder. Featured = the Home marquee of the mockup. */
export const technologies: TechnologySeed[] = [
  {
    name: '.NET Core',
    slug: 'dotnet-core',
    category: 'BACKEND',
    isFeatured: true,
  },
  { name: 'Laravel', slug: 'laravel', category: 'BACKEND', isFeatured: true },
  { name: 'Next.js', slug: 'nextjs', category: 'FRONTEND', isFeatured: true },
  { name: 'Nuxt', slug: 'nuxt', category: 'FRONTEND', isFeatured: true },
  { name: 'Angular', slug: 'angular', category: 'FRONTEND', isFeatured: true },
  { name: 'NestJS', slug: 'nestjs', category: 'BACKEND', isFeatured: true },
  {
    name: 'PostgreSQL',
    slug: 'postgresql',
    category: 'DATABASE',
    isFeatured: true,
  },
  {
    name: 'SQL Server',
    slug: 'sql-server',
    category: 'DATABASE',
    isFeatured: true,
  },
  { name: 'React', slug: 'react', category: 'FRONTEND', isFeatured: false },
  { name: 'Prisma', slug: 'prisma', category: 'BACKEND', isFeatured: false },
];

interface ServiceTranslationSeed {
  title: string;
  slug: string;
  description: string;
}

export interface ServiceSeed {
  /** Technology slugs, in display order. */
  technologies: string[];
  translations: Record<Locale, ServiceTranslationSeed>;
}

/** Order = sortOrder (Home "(03) Servicios"). */
export const services: ServiceSeed[] = [
  {
    technologies: ['dotnet-core', 'laravel', 'nestjs', 'postgresql'],
    translations: {
      ES: {
        title: 'Plataformas SaaS a medida',
        slug: 'plataformas-saas-a-medida',
        description:
          'Multi-tenant, roles y permisos, facturación recurrente, paneles e integraciones con servicios locales.',
      },
      EN: {
        title: 'Custom SaaS platforms',
        slug: 'custom-saas-platforms',
        description:
          'Multi-tenant, roles and permissions, recurring billing, dashboards and integrations with local services.',
      },
    },
  },
  {
    technologies: ['laravel', 'nextjs', 'postgresql'],
    translations: {
      ES: {
        title: 'Ecommerce y pagos',
        slug: 'ecommerce-y-pagos',
        description:
          'Tiendas online con catálogo, carrito y pasarelas de pago locales, integradas con inventario y facturación electrónica.',
      },
      EN: {
        title: 'Ecommerce and payments',
        slug: 'ecommerce-and-payments',
        description:
          'Online stores with catalogue, cart and local payment gateways, integrated with inventory and e-invoicing.',
      },
    },
  },
  {
    technologies: ['nestjs', 'dotnet-core', 'laravel'],
    translations: {
      ES: {
        title: 'APIs e integraciones',
        slug: 'apis-e-integraciones',
        description:
          'APIs REST seguras y documentadas, e integraciones con SUNAT, pasarelas de pago, ERPs y servicios de terceros.',
      },
      EN: {
        title: 'APIs and integrations',
        slug: 'apis-and-integrations',
        description:
          'Secure, documented REST APIs and integrations with SUNAT, payment gateways, ERPs and third-party services.',
      },
    },
  },
  {
    technologies: ['nextjs', 'nuxt', 'laravel'],
    translations: {
      ES: {
        title: 'Webs con CMS',
        slug: 'webs-con-cms',
        description:
          'Sitios rápidos, bilingües y preparados para SEO, con un panel para que tu equipo edite el contenido sin depender de desarrolladores.',
      },
      EN: {
        title: 'Websites with a CMS',
        slug: 'websites-with-cms',
        description:
          'Fast, bilingual, SEO-ready websites with a panel so your team can edit content without relying on developers.',
      },
    },
  },
  {
    technologies: ['nestjs', 'nextjs', 'postgresql'],
    translations: {
      ES: {
        title: 'IA aplicada y asistentes',
        slug: 'ia-aplicada-y-asistentes',
        description:
          'Asistentes que responden con la información de tu negocio y citan sus fuentes, búsqueda semántica y automatización de tareas con modelos de lenguaje.',
      },
      EN: {
        title: 'Applied AI and assistants',
        slug: 'applied-ai-and-assistants',
        description:
          'Assistants that answer with your business information and cite their sources, semantic search and task automation with language models.',
      },
    },
  },
];

interface CaseTranslationSeed {
  title: string;
  slug: string;
  tagline: string;
  summary: string;
  industry: string;
  blocks: CaseBlock[];
  seoTitle: string;
  seoDescription: string;
}

export interface CaseSeed {
  type: CaseType;
  client: string;
  anonymizeClient: boolean;
  year: number | null;
  /** Technology slugs, in display order. */
  technologies: string[];
  translations: Record<Locale, CaseTranslationSeed>;
}

type Metric = { value: string; label: string };

/** Challenge, solution and three sample metrics. */
function blocks(
  locale: Locale,
  challenge: string,
  solution: string,
  metrics: Metric[],
): CaseBlock[] {
  const es = locale === 'ES';
  return [
    { type: 'text', title: es ? 'El reto' : 'The challenge', body: challenge },
    {
      type: 'text',
      title: es ? 'La solución' : 'The solution',
      body: solution,
    },
    { type: 'metrics', items: metrics },
  ];
}

function seo(title: string, locale: Locale) {
  return `${title} · ${locale === 'ES' ? 'Caso de éxito' : 'Case study'} | miwebprofesional`;
}

/** Order = sortOrder (Home "(02) Casos"). All published in ES and EN. */
export const cases: CaseSeed[] = [
  {
    type: 'SAAS',
    client: 'Estudio contable (cliente de prueba)',
    anonymizeClient: false,
    year: 2025,
    technologies: ['dotnet-core', 'angular', 'sql-server'],
    translations: {
      ES: {
        title: 'ContaFlow IA',
        slug: 'contaflow-ia',
        tagline: 'SaaS · IA · Estudios contables',
        summary:
          'Plataforma SaaS para estudios contables en Perú: documentos fiscales, obligaciones, periodos y checklist de cierre.',
        industry: 'Estudios contables',
        blocks: blocks(
          'ES',
          'Los estudios contables gestionaban las obligaciones de decenas de clientes en hojas de cálculo y correos, con riesgo de vencimientos olvidados en cada cierre de mes.',
          'Una plataforma multi-empresa que centraliza documentos fiscales, calendario de obligaciones y un checklist de cierre por periodo, con un asistente que responde sobre el estado de cada cliente.',
          [
            { value: '40%', label: 'menos tiempo en el cierre mensual' },
            { value: '120+', label: 'empresas gestionadas por estudio' },
            { value: '0', label: 'vencimientos olvidados en el piloto' },
          ],
        ),
        seoTitle: seo('ContaFlow IA', 'ES'),
        seoDescription:
          'Plataforma SaaS para estudios contables en Perú: documentos fiscales, obligaciones, periodos y checklist de cierre.',
      },
      EN: {
        title: 'ContaFlow IA',
        slug: 'contaflow-ia',
        tagline: 'SaaS · AI · Accounting firms',
        summary:
          'SaaS platform for accounting firms in Peru: tax documents, obligations, periods and closing checklist.',
        industry: 'Accounting firms',
        blocks: blocks(
          'EN',
          "Accounting firms tracked dozens of clients' obligations in spreadsheets and emails, risking missed deadlines at every month-end close.",
          'A multi-company platform that centralizes tax documents, an obligations calendar and a per-period closing checklist, with an assistant that answers questions about each client.',
          [
            { value: '40%', label: 'less time on the monthly close' },
            { value: '120+', label: 'companies managed per firm' },
            { value: '0', label: 'missed deadlines during the pilot' },
          ],
        ),
        seoTitle: seo('ContaFlow IA', 'EN'),
        seoDescription:
          'SaaS platform for accounting firms in Peru: tax documents, obligations, periods and closing checklist.',
      },
    },
  },
  {
    // Challenge and solution from caso.html; the metrics are sample values.
    type: 'TOOL',
    client: 'Producto propio',
    anonymizeClient: false,
    year: 2026,
    technologies: ['nestjs', 'react', 'postgresql', 'prisma'],
    translations: {
      ES: {
        title: 'CorteMaestro',
        slug: 'cortemaestro',
        tagline: 'NestJS · React · PostgreSQL',
        summary:
          'Herramienta de despiece para carpinteros de melamina: del diseño del mueble a la lista de piezas y el plano de corte.',
        industry: 'Carpintería',
        blocks: [
          {
            type: 'text',
            title: 'El reto',
            body: 'Los carpinteros de melamina calculan a mano qué piezas cortar de cada tablero. Un error de medida o de espesor se traduce en material perdido.',
          },
          {
            type: 'text',
            title: 'La solución',
            body: 'Una herramienta donde se ingresa el diseño del mueble (medidas y espesor del tablero) y devuelve la lista de piezas y el plano de corte listo para el taller.',
          },
          {
            type: 'metrics',
            items: [
              { value: '18%', label: 'menos desperdicio de tablero' },
              { value: '5 min', label: 'por despiece de un mueble' },
              { value: '30', label: 'talleres usando la herramienta' },
            ],
          },
        ],
        seoTitle: seo('CorteMaestro', 'ES'),
        seoDescription:
          'Herramienta de despiece para carpinteros de melamina: del diseño del mueble a la lista de piezas y el plano de corte.',
      },
      EN: {
        title: 'CorteMaestro',
        slug: 'cortemaestro',
        tagline: 'NestJS · React · PostgreSQL',
        summary:
          'Cutting-list tool for melamine carpenters: from the furniture design to the parts list and the cutting plan.',
        industry: 'Carpentry',
        blocks: [
          {
            type: 'text',
            title: 'The challenge',
            body: 'Melamine carpenters work out by hand which parts to cut from each board. A wrong measurement or thickness turns into wasted material.',
          },
          {
            type: 'text',
            title: 'The solution',
            body: 'A tool where you enter the furniture design (measurements and board thickness) and get the parts list and a cutting plan ready for the workshop.',
          },
          {
            type: 'metrics',
            items: [
              { value: '18%', label: 'less board waste' },
              { value: '5 min', label: 'per furniture cutting list' },
              { value: '30', label: 'workshops using the tool' },
            ],
          },
        ],
        seoTitle: seo('CorteMaestro', 'EN'),
        seoDescription:
          'Cutting-list tool for melamine carpenters: from the furniture design to the parts list and the cutting plan.',
      },
    },
  },
  {
    type: 'ECOMMERCE',
    client: 'Ramos de Girasoles',
    anonymizeClient: false,
    year: 2025,
    technologies: ['laravel', 'nextjs', 'postgresql'],
    translations: {
      ES: {
        title: 'Ramos de Girasoles',
        slug: 'ramos-de-girasoles',
        tagline: 'Ecommerce · Talleres · Regalos corporativos',
        summary:
          'Tienda online de arreglos florales con reserva de talleres y pedidos de regalos corporativos.',
        industry: 'Talleres y regalos corporativos',
        blocks: blocks(
          'ES',
          'Las ventas, las reservas de talleres y los pedidos corporativos llegaban por redes sociales y se coordinaban a mano.',
          'Un ecommerce con catálogo, pasarela de pagos local, calendario de talleres con cupos y un flujo de cotización para empresas.',
          [
            { value: '3x', label: 'pedidos online frente al canal anterior' },
            { value: '85%', label: 'de talleres reservados sin intervención' },
            { value: '24/7', label: 'tienda disponible' },
          ],
        ),
        seoTitle: seo('Ramos de Girasoles', 'ES'),
        seoDescription:
          'Ecommerce de arreglos florales con reserva de talleres y pedidos de regalos corporativos.',
      },
      EN: {
        title: 'Ramos de Girasoles',
        slug: 'ramos-de-girasoles',
        tagline: 'Ecommerce · Workshops · Corporate gifts',
        summary:
          'Online flower shop with workshop bookings and corporate gift orders.',
        industry: 'Workshops and corporate gifts',
        blocks: blocks(
          'EN',
          'Sales, workshop bookings and corporate orders came in through social media and were coordinated by hand.',
          'An ecommerce site with catalogue, local payment gateway, a workshop calendar with seat limits and a quote flow for companies.',
          [
            { value: '3x', label: 'online orders vs the previous channel' },
            { value: '85%', label: 'of workshops booked with no manual work' },
            { value: '24/7', label: 'store availability' },
          ],
        ),
        seoTitle: seo('Ramos de Girasoles', 'EN'),
        seoDescription:
          'Flower shop ecommerce with workshop bookings and corporate gift orders.',
      },
    },
  },
  {
    type: 'WEB_CMS',
    client: '8 Reyes',
    anonymizeClient: false,
    year: 2024,
    technologies: ['nuxt', 'laravel'],
    translations: {
      ES: {
        title: '8 Reyes',
        slug: '8-reyes',
        tagline: 'Web + CMS · Música andina contemporánea',
        summary:
          'Sitio web bilingüe para una agrupación de música andina contemporánea, con agenda de conciertos y discografía.',
        industry: 'Música andina contemporánea',
        blocks: blocks(
          'ES',
          'La agrupación dependía de redes sociales para anunciar conciertos y no tenía un lugar propio para su discografía y prensa.',
          'Un sitio bilingüe con CMS para que la banda publique fechas, noticias, discos y material de prensa sin ayuda técnica.',
          [
            { value: '2', label: 'idiomas gestionados desde el panel' },
            { value: '95', label: 'puntos de rendimiento en Lighthouse' },
            { value: '100%', label: 'del contenido editado por la banda' },
          ],
        ),
        seoTitle: seo('8 Reyes', 'ES'),
        seoDescription:
          'Web bilingüe con CMS para una agrupación de música andina contemporánea.',
      },
      EN: {
        title: '8 Reyes',
        slug: '8-reyes',
        tagline: 'Web + CMS · Contemporary Andean music',
        summary:
          'Bilingual website for a contemporary Andean music group, with a concert schedule and discography.',
        industry: 'Contemporary Andean music',
        blocks: blocks(
          'EN',
          'The group relied on social media to announce concerts and had no place of its own for its discography and press.',
          'A bilingual site with a CMS so the band can publish dates, news, albums and press material without technical help.',
          [
            { value: '2', label: 'languages managed from the panel' },
            { value: '95', label: 'Lighthouse performance score' },
            { value: '100%', label: 'of content edited by the band' },
          ],
        ),
        seoTitle: seo('8 Reyes', 'EN'),
        seoDescription:
          'Bilingual website with a CMS for a contemporary Andean music group.',
      },
    },
  },
  {
    type: 'PLATFORM',
    client: 'Equipo de QA (cliente de prueba)',
    anonymizeClient: true,
    year: 2025,
    technologies: ['nestjs', 'react', 'postgresql'],
    translations: {
      ES: {
        title: 'SLA Manager',
        slug: 'sla-manager',
        tagline: 'QA · Gestión de acuerdos de servicio',
        summary:
          'Plataforma para registrar acuerdos de nivel de servicio, medir su cumplimiento y alertar antes de cada incumplimiento.',
        industry: 'QA · Gestión de acuerdos de servicio',
        blocks: blocks(
          'ES',
          'El cumplimiento de los SLA se calculaba al final de cada mes, cuando ya no había margen para corregir.',
          'Una plataforma que mide cada acuerdo en tiempo real, alerta a los responsables antes del vencimiento y genera los reportes para el cliente.',
          [
            {
              value: '99.2%',
              label: 'de SLA cumplidos tras la implementación',
            },
            { value: '15 min', label: 'de anticipación en las alertas' },
            { value: '-70%', label: 'de tiempo en reportes mensuales' },
          ],
        ),
        seoTitle: seo('SLA Manager', 'ES'),
        seoDescription:
          'Plataforma para medir el cumplimiento de acuerdos de nivel de servicio y alertar antes de cada incumplimiento.',
      },
      EN: {
        title: 'SLA Manager',
        slug: 'sla-manager',
        tagline: 'QA · Service level agreement management',
        summary:
          'Platform to record service level agreements, measure compliance and alert before every breach.',
        industry: 'QA · Service level agreement management',
        blocks: blocks(
          'EN',
          'SLA compliance was calculated at the end of each month, when there was no room left to fix anything.',
          'A platform that measures every agreement in real time, alerts owners before deadlines and produces the client reports.',
          [
            { value: '99.2%', label: 'SLAs met after rollout' },
            { value: '15 min', label: 'of advance warning on alerts' },
            { value: '-70%', label: 'time spent on monthly reports' },
          ],
        ),
        seoTitle: seo('SLA Manager', 'EN'),
        seoDescription:
          'Platform to measure service level agreement compliance and alert before every breach.',
      },
    },
  },
];

const weekday = [{ start: '08:00', end: '19:00' }];

export const siteSettings = {
  // Sample contact data; editable from the admin (Ajustes).
  contactEmail: 'hola@miwebprofesional.com',
  whatsapp: '51900000000',
  socialLinks: {
    linkedin: 'https://www.linkedin.com/company/miwebprofesional',
    github: 'https://github.com/miwebprofesional',
    instagram: 'https://www.instagram.com/miwebprofesional',
  },
  // Monday to Saturday, 08:00–19:00 (America/Lima).
  businessHours: {
    mon: weekday,
    tue: weekday,
    wed: weekday,
    thu: weekday,
    fri: weekday,
    sat: weekday,
    sun: [],
  },
  timezone: 'America/Lima',
  meetingDurationMinutes: 30,
};
