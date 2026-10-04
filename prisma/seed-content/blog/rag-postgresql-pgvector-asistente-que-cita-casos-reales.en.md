---
title: "RAG with PostgreSQL + pgvector: an assistant that answers by citing real cases"
slug: "rag-postgresql-pgvector-assistant-that-cites-real-cases"
excerpt: "The design of the AI assistant we're building for miwebprofesional: per-locale chunks, Voyage AI embeddings, pgvector search, Claude tools, mandatory citations and no made-up answers."
seoTitle: "RAG with PostgreSQL and pgvector: an assistant that cites"
seoDescription: "Designing a RAG assistant with pgvector, Voyage AI and Claude: per-locale chunks, an HNSW index, tools, citations, unanswered questions and prompt caching."
technologies: ["pgvector", "postgresql", "claude", "voyage-ai"]
publishedAt: "2026-10-02"
---

We're building an assistant for miwebprofesional.com that answers questions about our work ("have you built something similar for a clinic?") **by citing the real case studies published on the site**. It isn't live yet, so this post covers the design we're implementing, with no metrics, because we don't have any yet.

## What we want (and what we don't)

The rule: the assistant only states what's in our published case studies and FAQs, and says where it got it. If it can't find something, it admits it and offers to connect the visitor with the team. We'd much rather show "I don't have that information" than a convincing made-up answer.

That's what RAG (retrieval-augmented generation) is for: before answering, the model retrieves relevant chunks and answers from them. The building blocks:

- **PostgreSQL + pgvector** for chunks and their vectors (the `vector` extension has been there since our initial migration);
- **Voyage AI** for embeddings, with a multilingual model (Spanish and English);
- **Claude** (Sonnet 5.5) with tools to search and to record leads.

## Per-locale chunks with stable ids

We only index **published** content: case studies flagged "Include in AI knowledge base" and FAQs. Each case is chunked per locale, because each translation is published separately with its own slug. An English question searches English chunks first.

Every chunk carries a stable id that says exactly where it came from:

```ts
type SourceId =
  | `caso:${string}#${number}` // caso:<slug>#<n>, using the chunk's locale slug
  | `faq:${string}#${number}`; // faq:<id>#<n>
```

A typical id looks like `caso:online-store#2`. Since the slug belongs to a locale, the front end turns a citation into a link to the right page. Republishing a case replaces its chunks for that locale.

## Voyage AI embeddings: `document` vs `query`

Voyage separates what you index from what you search through the `input_type` parameter: `"document"` when indexing chunks, and `"query"` when embedding the visitor's question. The model shapes the vector according to the text's role, and mixing the two hurts retrieval.

The Voyage client sits behind our own `EmbeddingsProvider` interface, so the rest of the code isn't tied to one vendor. The vector dimension **depends on the Voyage model** we pick, and the pgvector column is declared with that exact dimension. Switching models means reindexing everything, since vectors from different models aren't comparable.

## Similarity search in pgvector

The chunk table is created with plain SQL in a migration. A simplified version:

```sql
CREATE TABLE knowledge_chunks (
  id          text PRIMARY KEY,
  source_id   text NOT NULL,           -- 'caso:<slug>#<n>' or 'faq:<id>#<n>'
  locale      text NOT NULL,           -- 'es' | 'en'
  content     text NOT NULL,
  embedding   vector(DIM) NOT NULL,    -- DIM = dimension of the chosen Voyage model
  UNIQUE (locale, source_id)
);

-- Approximate HNSW index on cosine distance, partial per locale (plus the same for 'en').
CREATE INDEX knowledge_chunks_es_hnsw ON knowledge_chunks
  USING hnsw (embedding vector_cosine_ops) WHERE locale = 'es';
```

In the query below, the operator in the `ORDER BY` is pgvector's cosine **distance** (lower means more similar), so similarity is `1 - distance`. From the API we run parameterized SQL through Prisma. The vector travels as text (`[0.12,-0.03,…]`, which is exactly what `JSON.stringify` produces) and is cast with `::vector`:

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

Why partial indexes? With an approximate index, the `WHERE` filter runs after the index scan and can return fewer rows than requested. With only two locales, one index per locale avoids that. If we need more recall, `hnsw.ef_search` widens the search at the cost of speed.

## The tools: `buscar_casos` and `crear_lead`

The model doesn't get every case study stuffed into its prompt. It gets tools, and it decides when to call them. (The tool names are in Spanish, like the rest of our domain.)

```ts
const tools: Anthropic.Tool[] = [
  {
    name: 'buscar_casos',
    description:
      "Searches the studio's published case studies and FAQs. Returns chunks with their source id. " +
      'Use it before answering about projects, technologies or services, and cite the ids you use.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What the visitor wants to know' },
        tipo: { type: 'string', description: 'Case type, if the visitor mentions one' },
        tecnologia: { type: 'string', description: 'Technology, if the visitor mentions one' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    strict: true,
  },
  // crear_lead follows the same pattern: nombre, contacto, interes and resumen, all required.
];
```

`strict: true` guarantees the arguments match the schema, and we still validate them on the server. `crear_lead` creates a lead tagged as coming from the AI chat, linked to the conversation. If a tool fails, we send back a `tool_result` with `is_error: true` rather than dropping it.

## Cite, or don't answer

`buscar_casos` returns each chunk with its `sourceId`, and the instructions require the model to cite the ids it used. The front end renders them as "Cited case" cards that link to the case study.

The interesting part is what happens when nothing matches. A **similarity threshold**, tunable from the admin panel, decides that. If no chunk clears it, the tool returns an empty list and the conversation is flagged as **unanswered**. The model must say it doesn't have that information and offer to connect the visitor with the team. In the panel, those questions can be turned into new FAQs, so the knowledge base grows from what people actually ask.

## "Anonymize client" happens at indexing time

Some case studies are published without the client's name. That flag isn't enforced when answering but **when indexing**: chunks are generated without the name, so it never reaches the vector store or the model, and no clever question can coax it out. The limit: text can still identify someone through indirect details, which no filter catches, so editorial review is still needed.

## Retrieved content is data, not instructions

Everything that enters the context from outside, meaning the visitor's question and the retrieved chunks, is treated as **data**. The system instructions say so explicitly, and the design limits how much damage is even possible:

- tools get the least power possible (search public content, create a lead); none can read other leads;
- arguments are validated on the server;
- the assistant doesn't reveal its instructions;
- requests are rate-limited per IP, and messages are capped per session.

## Prompt caching: order matters

Instructions and tool definitions repeat on every message, so we cache them. Claude's cache works on the **prefix**, rendered as `tools` → `system` → `messages`, and any change in the prefix invalidates everything after it. So:

```ts
const stream = client.messages.stream({
  model: settings.model,                 // configured in the admin panel, not hardcoded
  max_tokens: MAX_TOKENS,
  output_config: { effort: settings.effort },
  tools,                                 // 1. always the same tools, in the same order
  system: [
    // 2. frozen instructions; this breakpoint caches tools + system together
    { type: 'text', text: settings.instructions, cache_control: { type: 'ephemeral' } },
  ],
  messages,                              // 3. everything that varies goes last
});
```

Nothing variable goes before the breakpoint: not the date, not the conversation id, not the case the visitor is looking at. All of that travels in the messages. To confirm the cache is working, we log `usage.cache_read_input_tokens` on every response, along with the rest of the usage data, for the cost dashboard.

## Where we are

The foundations are in place: PostgreSQL with pgvector, bilingual case studies with their "Include in AI knowledge base" and "Anonymize client" flags, and the admin panel to edit them. Indexing, streaming chat, tools and conversation logs are under construction. Before opening it to the public, we'll test it with real questions and review both answers and citations.

## In short

- Per-locale chunks, from published content only, with stable ids like `caso:online-store#2`.
- Voyage AI with `input_type` set to `document` when indexing and `query` when searching. The model sets the dimension.
- pgvector with cosine distance and partial HNSW indexes per locale.
- Claude with `buscar_casos` and `crear_lead`: always cite, and flag the question as unanswered when nothing clears the threshold.
- "Anonymize client" is enforced at indexing time, and retrieved content is data, never instructions.
- Prompt caching with a stable prefix: `tools` → `system` → `messages`.

If you're considering an assistant that answers from your own data, let's talk. The references we rely on are the [pgvector docs](https://github.com/pgvector/pgvector), [Voyage AI's embeddings docs](https://docs.voyageai.com/docs/embeddings) and [Claude's prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).
