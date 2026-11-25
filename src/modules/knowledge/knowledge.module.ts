import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { AdminKnowledgeController } from './admin-knowledge.controller.js';
import { EMBEDDINGS_PROVIDER } from './embeddings/embeddings-provider.js';
import { VoyageEmbeddingsProvider } from './embeddings/voyage-embeddings.provider.js';
import { KnowledgeIndexerService } from './knowledge-indexer.service.js';
import { KnowledgeSearchService } from './knowledge-search.service.js';
import { KnowledgeStatusService } from './knowledge-status.service.js';
import { KnowledgeSyncService } from './knowledge-sync.service.js';

/**
 * Knowledge base of the assistant: chunks of published cases and FAQs per
 * locale, Voyage embeddings in pgvector, incremental sync and search. Global
 * so the content modules (cases, FAQs) can schedule a sync without importing it.
 */
@Global()
@Module({
  controllers: [AdminKnowledgeController],
  providers: [
    {
      provide: EMBEDDINGS_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new VoyageEmbeddingsProvider({
          apiKey: config.get('VOYAGE_API_KEY', { infer: true }),
          model: config.get('VOYAGE_MODEL', { infer: true }),
        }),
    },
    KnowledgeIndexerService,
    KnowledgeSearchService,
    KnowledgeStatusService,
    KnowledgeSyncService,
  ],
  exports: [KnowledgeSearchService, KnowledgeSyncService, EMBEDDINGS_PROVIDER],
})
export class KnowledgeModule {}
