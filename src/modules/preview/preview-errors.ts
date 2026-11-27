import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

export type PreviewErrorReason =
  | 'preview_disabled'
  | 'invalid_secret'
  | 'invalid_token'
  | 'no_slug';

export function previewDisabled(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    message: 'La vista previa no está configurada',
    error: 'Service Unavailable',
    details: { reason: 'preview_disabled' satisfies PreviewErrorReason },
  });
}

export function invalidSecret(): UnauthorizedException {
  return new UnauthorizedException({
    message: 'Secreto de vista previa inválido',
    error: 'Unauthorized',
    details: { reason: 'invalid_secret' satisfies PreviewErrorReason },
  });
}

export function invalidToken(): UnauthorizedException {
  return new UnauthorizedException({
    message: 'Token de vista previa inválido o expirado',
    error: 'Unauthorized',
    details: { reason: 'invalid_token' satisfies PreviewErrorReason },
  });
}
