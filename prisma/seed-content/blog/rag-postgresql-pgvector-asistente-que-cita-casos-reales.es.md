---
title: "RAG con PostgreSQL + pgvector: un asistente que responde citando casos reales"
slug: "rag-postgresql-pgvector-asistente-que-cita-casos-reales"
excerpt: "El diseño del asistente IA que estamos construyendo para miwebprofesional: fragmentos por idioma, embeddings de Voyage AI, búsqueda en pgvector, herramientas de Claude, citas obligatorias y cero invenciones."
seoTitle: "RAG con PostgreSQL y pgvector: un asistente que cita"
seoDescription: "Diseño de un asistente RAG con pgvector, Voyage AI y Claude: fragmentos por idioma, índice HNSW, tools, citas, preguntas sin respuesta y prompt caching."
technologies: ["pgvector", "postgresql", "claude", "voyage-ai"]
publishedAt: "2026-10-02"
---

Estamos construyendo para miwebprofesional.com un asistente que responde preguntas sobre nuestro trabajo ("¿han hecho algo parecido para una clínica?") **citando los casos reales publicados en la web**. Todavía no está en producción: aquí contamos el diseño que estamos implementando, sin métricas, porque aún no las tenemos.

## Qué queremos (y qué no)

La regla: el asistente solo afirma lo que está en nuestros casos y FAQ publicados, y dice de dónde lo sacó. Si no lo encuentra, lo admite y ofrece hablar con el equipo. Preferimos un "no tengo esa información" a una respuesta convincente e inventada.

Para eso usamos RAG (*retrieval-augmented generation*): antes de responder, el modelo busca fragmentos relevantes y responde a partir de ellos. Las piezas:

- **PostgreSQL + pgvector** para los fragmentos y sus vectores (la extensión `vector` existe desde nuestra migración inicial);
- **Voyage AI** para los embeddings, con un modelo multilingüe (español e inglés);
- **Claude** (Sonnet 5.5) con herramientas para buscar y registrar interesados.

## Fragmentos por idioma, con ids estables

Indexamos solo contenido **publicado**: los casos marcados con "Incluir en la base IA" y las FAQ. Cada caso se trocea por idioma, porque cada traducción se publica por separado y tiene su propio slug. Una pregunta en inglés busca primero en inglés.

Cada fragmento lleva un id estable que dice exactamente de dónde viene:

```ts
type SourceId =
  | `caso:${string}#${number}` // caso:<slug>#<n>, el slug del idioma del fragmento
  | `faq:${string}#${number}`; // faq:<id>#<n>
```

Un ejemplo es `caso:tienda-online#2`. Como el slug pertenece al idioma, el front convierte la cita en un enlace a la página correcta. Al volver a publicar un caso se reemplazan sus fragmentos de ese idioma.

## Embeddings con Voyage AI: `document` frente a `query`

Voyage distingue entre lo que se indexa y lo que se busca con el parámetro `input_type`: `"document"` al indexar los fragmentos y `"query"` al convertir la pregunta del visitante. El modelo ajusta el vector según el papel del texto, y mezclarlos empeora la búsqueda.

El cliente de Voyage queda detrás de una interfaz propia (`EmbeddingsProvider`), para no atar el resto del código a un proveedor. La dimensión del vector **depende del modelo** de Voyage que elijamos, y la columna de pgvector se declara con esa dimensión exacta. Cambiar de modelo obliga a reindexar todo: los vectores de modelos distintos no son comparables.

## Búsqueda por similitud en pgvector

La tabla de fragmentos se crea con SQL en una migración. Un esquema simplificado:

```sql
CREATE TABLE knowledge_chunks (
  id          text PRIMARY KEY,
  source_id   text NOT NULL,           -- 'caso:<slug>#<n>' o 'faq:<id>#<n>'
  locale      text NOT NULL,           -- 'es' | 'en'
  content     text NOT NULL,
  embedding   vector(DIM) NOT NULL,    -- DIM = dimensión del modelo de Voyage elegido
  UNIQUE (locale, source_id)
);

-- Índice aproximado HNSW con distancia coseno, parcial por idioma (y otro igual para 'en').
CREATE INDEX knowledge_chunks_es_hnsw ON knowledge_chunks
  USING hnsw (embedding vector_cosine_ops) WHERE locale = 'es';
```

En la consulta de abajo, el operador que aparece en el `ORDER BY` es la **distancia** coseno de pgvector (menor es más parecido), así que la similitud es `1 - distancia`. Desde la API usamos SQL parametrizado con Prisma. El vector viaja como texto (`[0.12,-0.03,…]`, que es justo lo que produce `JSON.stringify`) y se convierte con `::vector`:

```ts
const vector = JSON.stringify(queryEmbedding);
const hits = await this.prisma.$queryRaw<ChunkHit[]>`
  SELECT source_id AS "sourceId", content,
         1 - (embedding <=> ${vector}::vector) AS similarity
  FROM knowledge_chunks
  WHERE locale = ${locale}
  ORDER BY embedding <=> ${vector}::vector
  LIMIT ${limit}
`;
```

¿Por qué índices parciales? Con un índice aproximado, el `WHERE` se aplica después de recorrer el índice y puede devolver menos filas de las pedidas. Con solo dos idiomas, un índice por idioma lo evita. Si hiciera falta más recall, `hnsw.ef_search` amplía la búsqueda a cambio de velocidad.

## Las herramientas: `buscar_casos` y `crear_lead`

El modelo no recibe todos los casos en el prompt. Recibe herramientas y decide cuándo usarlas:

```ts
const tools: Anthropic.Tool[] = [
  {
    name: 'buscar_casos',
    description:
      'Busca en los casos y FAQ publicados del estudio. Devuelve fragmentos con su id de fuente. ' +
      'Úsala antes de responder sobre proyectos, tecnologías o servicios, y cita los ids que uses.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Lo que el visitante quiere saber' },
        tipo: { type: 'string', description: 'Tipo de caso, si el visitante lo menciona' },
        tecnologia: { type: 'string', description: 'Tecnología, si el visitante la menciona' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    strict: true,
  },
  // crear_lead sigue el mismo patrón: nombre, contacto, interes y resumen, todos obligatorios.
];
```

`strict: true` garantiza que los argumentos cumplan el esquema, y aun así los validamos en el servidor. `crear_lead` crea el lead con origen "chat IA", vinculado a la conversación. Si una herramienta falla, devolvemos un `tool_result` con `is_error: true` en lugar de omitirlo.

## Citar o no responder

El resultado de `buscar_casos` devuelve cada fragmento con su `sourceId`, y las instrucciones exigen citar los ids usados. El front los muestra como tarjetas de "Caso citado" con enlace al caso.

Lo más importante es qué pasa cuando no hay nada. Hay un **umbral de similitud** configurable desde el panel: si ningún fragmento lo supera, la herramienta devuelve una lista vacía y la conversación queda marcada como **"sin respuesta"**. El modelo debe decir que no tiene esa información y ofrecer el contacto con el equipo. En el panel, esas preguntas se pueden convertir en FAQ nuevas, y así la base crece con lo que la gente realmente pregunta.

## "Anonimizar cliente" se respeta al indexar

Algunos casos se publican sin el nombre del cliente. Ese flag no se aplica al responder, sino **al indexar**: los fragmentos se generan sin el nombre, así que nunca llega a la base vectorial ni al modelo, y ninguna pregunta ingeniosa puede sacárselo. El límite: un texto puede identificar a alguien por detalles indirectos, y eso no lo detecta ningún filtro, así que la revisión editorial sigue siendo necesaria.

## Lo recuperado es dato, no instrucciones

Todo lo que entra al contexto desde fuera (la pregunta del visitante y los fragmentos recuperados) se trata como **dato**. Las instrucciones del sistema lo dicen de forma explícita, y el diseño limita el daño posible:

- las herramientas tienen el menor poder posible (buscar contenido público y crear un lead); ninguna lee datos de otros leads;
- los argumentos se validan en el servidor;
- el asistente no revela sus instrucciones;
- hay límite de peticiones por IP y de mensajes por sesión.

## Prompt caching: el orden importa

Las instrucciones y las herramientas se repiten en cada mensaje, así que las cacheamos. La caché de Claude funciona por **prefijo**, en el orden `tools` → `system` → `messages`, y cualquier cambio en el prefijo invalida todo lo que viene después. Por eso:

```ts
const stream = client.messages.stream({
  model: settings.model,                 // se configura en el panel, no está fijo en el código
  max_tokens: MAX_TOKENS,
  output_config: { effort: settings.effort },
  tools,                                 // 1. siempre las mismas, en el mismo orden
  system: [
    // 2. instrucciones congeladas; este breakpoint cachea tools + system
    { type: 'text', text: settings.instructions, cache_control: { type: 'ephemeral' } },
  ],
  messages,                              // 3. lo variable va al final
});
```

Nada variable va antes del breakpoint: ni la fecha, ni el id de la conversación, ni el caso de la página. Eso viaja en los mensajes. Para comprobar que la caché funciona, registramos `usage.cache_read_input_tokens` en cada respuesta, junto con el resto del uso, para el panel de costos.

## Dónde estamos

Ya tenemos la base: PostgreSQL con pgvector, los casos bilingües con sus flags "Incluir en la base IA" y "Anonimizar cliente", y el panel para editarlos. La indexación, el chat con streaming, las herramientas y el registro de conversaciones están en construcción. Antes de abrirlo al público lo probaremos con preguntas reales, revisando respuestas y citas.

## En resumen

- Fragmentos por idioma, solo de contenido publicado, con ids estables como `caso:tienda-online#2`.
- Voyage AI con `input_type` `document` al indexar y `query` al buscar; la dimensión la define el modelo.
- pgvector con distancia coseno e índices HNSW parciales por idioma.
- Claude con `buscar_casos` y `crear_lead`: citar siempre y marcar "sin respuesta" cuando nada supera el umbral.
- "Anonimizar cliente" se aplica al indexar, y el contenido recuperado es dato, nunca instrucciones.
- Prompt caching con un prefijo estable: `tools` → `system` → `messages`.

Si estás pensando en un asistente que responda con tus propios datos, conversemos. Las referencias que usamos son la documentación de [pgvector](https://github.com/pgvector/pgvector), la de [embeddings de Voyage AI](https://docs.voyageai.com/docs/embeddings) y la de [prompt caching de Claude](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).
