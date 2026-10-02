import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Opts a route (or a whole controller) out of the global JwtAuthGuard.
 * Every other endpoint requires a valid access token by default.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
