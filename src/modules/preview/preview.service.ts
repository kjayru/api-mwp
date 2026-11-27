import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  PUBLIC_LOCALES,
  type PublicLocale,
  toDbLocale,
} from '../../common/i18n/locale.js';
import type { Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BlogService } from '../blog/blog.service.js';
import type { PublicBlogPostDetail } from '../blog/entities/blog.entity.js';
import { CasesService } from '../cases/cases.service.js';
import type { PublicCaseDetail } from '../cases/entities/public-case.entity.js';
import {
  PREVIEW_TYPES,
  type CreatePreviewDto,
  type PreviewType,
} from './dto/preview.dto.js';
import { invalidToken, previewDisabled } from './preview-errors.js';

export const PREVIEW_AUDIENCE = 'preview';
export const PREVIEW_TTL_SECONDS = 600;

const NOT_FOUND: Record<PreviewType, string> = {
  case: 'Caso no encontrado',
  post: 'Artículo no encontrado',
};

export interface PreviewTokenPayload {
  type: PreviewType;
  id: string;
  locale: PublicLocale;
}

export interface PreviewLink {
  url: string;
  expiresAt: string;
}

export interface ResolvedPreview extends PreviewTokenPayload {
  slug: string;
}

function isPayload(value: unknown): value is PreviewTokenPayload {
  if (typeof value !== 'object' || value === null) return false;
  const { type, id, locale } = value as Record<string, unknown>;
  return (
    PREVIEW_TYPES.includes(type as PreviewType) &&
    typeof id === 'string' &&
    id.length > 0 &&
    PUBLIC_LOCALES.includes(locale as PublicLocale)
  );
}

/**
 * Draft preview: the admin gets a short-lived link to the site's draft mode,
 * and the front resolves it (with the shared secret) and reads the draft
 * through the same builders as the public detail endpoints.
 */
@Injectable()
export class PreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly cases: CasesService,
    private readonly blog: BlogService,
  ) {}

  async createLink(dto: CreatePreviewDto): Promise<PreviewLink> {
    const secret = this.secret();
    const slug = await this.slugOf(dto.type, dto.id, dto.locale);
    if (slug === null) {
      const locale = toDbLocale(dto.locale);
      throw new UnprocessableEntityException({
        message: `La versión ${locale} aún no tiene slug, no se puede previsualizar`,
        error: 'Unprocessable Entity',
        details: { reason: 'no_slug', locale },
      });
    }
    const payload: PreviewTokenPayload = {
      type: dto.type,
      id: dto.id,
      locale: dto.locale,
    };
    const issuedAt = Math.floor(Date.now() / 1000);
    const token = this.jwt.sign(
      { ...payload, iat: issuedAt },
      {
        secret,
        algorithm: 'HS256',
        audience: PREVIEW_AUDIENCE,
        expiresIn: PREVIEW_TTL_SECONDS,
      },
    );
    const base = this.config.get('FRONT_URL', { infer: true });
    return {
      url: `${base}/api/draft?token=${encodeURIComponent(token)}`,
      expiresAt: new Date(
        (issuedAt + PREVIEW_TTL_SECONDS) * 1000,
      ).toISOString(),
    };
  }

  async resolve(token: string): Promise<ResolvedPreview> {
    const secret = this.secret();
    let payload: unknown;
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret,
        algorithms: ['HS256'],
        audience: PREVIEW_AUDIENCE,
      });
    } catch {
      throw invalidToken();
    }
    if (!isPayload(payload)) throw invalidToken();
    const slug = await this.slugOf(payload.type, payload.id, payload.locale);
    if (slug === null) throw new NotFoundException(NOT_FOUND[payload.type]);
    return {
      type: payload.type,
      id: payload.id,
      locale: payload.locale,
      slug,
    };
  }

  caseBySlug(locale: PublicLocale, slug: string): Promise<PublicCaseDetail> {
    return this.cases.findBySlug(locale, slug, { includeDrafts: true });
  }

  postBySlug(
    locale: PublicLocale,
    slug: string,
  ): Promise<PublicBlogPostDetail> {
    return this.blog.findBySlug(locale, slug, { includeDrafts: true });
  }

  private secret(): string {
    const secret = this.config.get('PREVIEW_SECRET', { infer: true });
    if (!secret) throw previewDisabled();
    return secret;
  }

  /**
   * Current slug of the locale's translation, or null when the entity has no
   * such translation (or an empty slug). 404 when the entity is unknown or deleted.
   */
  private async slugOf(
    type: PreviewType,
    id: string,
    publicLocale: PublicLocale,
  ): Promise<string | null> {
    const translations = {
      where: { locale: toDbLocale(publicLocale) },
      select: { slug: true },
    };
    const row =
      type === 'case'
        ? await this.prisma.case.findFirst({
            where: { id, deletedAt: null },
            select: { translations },
          })
        : await this.prisma.blogPost.findFirst({
            where: { id, deletedAt: null },
            select: { translations },
          });
    if (!row) throw new NotFoundException(NOT_FOUND[type]);
    return row.translations[0]?.slug?.trim() || null;
  }
}
