import { IsEnum, IsOptional } from 'class-validator';
import { PublicLocaleQueryDto } from '../../../common/i18n/locale.js';
import { CaseType } from '../../../generated/prisma/enums.js';

/** `GET /cases?locale=es&type=SAAS` */
export class PublicCasesQueryDto extends PublicLocaleQueryDto {
  @IsOptional()
  @IsEnum(CaseType, {
    message: 'type debe ser SAAS, ECOMMERCE, WEB_CMS, TOOL o PLATFORM',
  })
  type?: CaseType;
}
