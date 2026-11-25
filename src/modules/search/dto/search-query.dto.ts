import { IsString, Length } from 'class-validator';
import { Trim } from '../../../common/validation/transforms.js';

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 100;

/** `GET /admin/search?q=` */
export class SearchQueryDto {
  @Trim()
  @IsString({ message: 'q es obligatorio' })
  @Length(SEARCH_MIN_LENGTH, SEARCH_MAX_LENGTH, {
    message: `q debe tener entre ${SEARCH_MIN_LENGTH} y ${SEARCH_MAX_LENGTH} caracteres`,
  })
  q: string;
}
