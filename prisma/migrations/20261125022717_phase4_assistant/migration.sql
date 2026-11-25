-- CreateEnum
CREATE TYPE "knowledge_source_type" AS ENUM ('CASE', 'FAQ');

-- CreateEnum
CREATE TYPE "indexing_run_status" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "message_role" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "meeting_status" AS ENUM ('REQUESTED', 'BOOKED', 'CANCELLED');

-- CreateTable
CREATE TABLE "faq_documents" (
    "id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "faq_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faq_document_translations" (
    "id" TEXT NOT NULL,
    "faq_document_id" TEXT NOT NULL,
    "locale" "locale" NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL DEFAULT '',
    "status" "publication_status" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faq_document_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" TEXT NOT NULL,
    "source_type" "knowledge_source_type" NOT NULL,
    "source_id" TEXT NOT NULL,
    "locale" "locale" NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "source_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "content" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "token_count" INTEGER,
    "case_type" "case_type",
    "technologies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "embedding_model" TEXT NOT NULL,
    "embedding" vector(1024),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indexing_runs" (
    "id" TEXT NOT NULL,
    "status" "indexing_run_status" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "sources_count" INTEGER NOT NULL DEFAULT 0,
    "chunks_count" INTEGER NOT NULL DEFAULT 0,
    "embedded_count" INTEGER NOT NULL DEFAULT 0,
    "removed_count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "indexing_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "locale" "locale" NOT NULL,
    "case_slug" TEXT,
    "has_lead" BOOLEAN NOT NULL DEFAULT false,
    "unanswered" BOOLEAN NOT NULL DEFAULT false,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" "message_role" NOT NULL,
    "content" TEXT NOT NULL,
    "context" TEXT,
    "locale" "locale",
    "case_slug" TEXT,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "tool_calls" JSONB NOT NULL DEFAULT '[]',
    "usage" JSONB,
    "model" TEXT,
    "stop_reason" TEXT,
    "unanswered" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meetings" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "google_event_id" TEXT,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "meet_link" TEXT,
    "status" "meeting_status" NOT NULL DEFAULT 'REQUESTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "model" TEXT NOT NULL DEFAULT 'claude-sonnet-5-5',
    "effort" TEXT NOT NULL DEFAULT 'low',
    "instructions" TEXT NOT NULL,
    "enabled_tools" TEXT[] DEFAULT ARRAY['buscar_casos', 'crear_lead', 'agendar_reunion']::TEXT[],
    "max_messages_per_session" INTEGER NOT NULL DEFAULT 20,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistant_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "faq_documents_deleted_at_sort_order_idx" ON "faq_documents"("deleted_at", "sort_order");

-- CreateIndex
CREATE INDEX "faq_document_translations_locale_status_idx" ON "faq_document_translations"("locale", "status");

-- CreateIndex
CREATE UNIQUE INDEX "faq_document_translations_faq_document_id_locale_key" ON "faq_document_translations"("faq_document_id", "locale");

-- CreateIndex
CREATE INDEX "knowledge_chunks_source_type_source_id_idx" ON "knowledge_chunks"("source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_locale_source_key_key" ON "knowledge_chunks"("locale", "source_key");

-- CreateIndex
CREATE INDEX "indexing_runs_started_at_idx" ON "indexing_runs"("started_at");

-- CreateIndex
CREATE INDEX "conversations_visitor_id_idx" ON "conversations"("visitor_id");

-- CreateIndex
CREATE INDEX "conversations_last_message_at_idx" ON "conversations"("last_message_at");

-- CreateIndex
CREATE INDEX "conversations_created_at_idx" ON "conversations"("created_at");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_role_created_at_idx" ON "messages"("role", "created_at");

-- CreateIndex
CREATE INDEX "meetings_lead_id_idx" ON "meetings"("lead_id");

-- CreateIndex
CREATE INDEX "meetings_conversation_id_idx" ON "meetings"("conversation_id");

-- CreateIndex
CREATE INDEX "meetings_start_idx" ON "meetings"("start");

-- Leads created before Phase 4 cannot point at a conversation yet: clear any
-- stale value so the new foreign key can be added.
UPDATE "leads" SET "conversation_id" = NULL WHERE "conversation_id" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faq_document_translations" ADD CONSTRAINT "faq_document_translations_faq_document_id_fkey" FOREIGN KEY ("faq_document_id") REFERENCES "faq_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Approximate nearest-neighbour search on the embeddings (cosine distance, the
-- <=> operator). Prisma cannot declare HNSW indexes, so it lives here.
CREATE INDEX "knowledge_chunks_embedding_hnsw_idx" ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);
