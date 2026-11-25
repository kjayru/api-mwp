import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { IsOptionalNonNull } from '../../../common/validation/is-optional-non-null.js';
import { Trim } from '../../../common/validation/transforms.js';
import { UserRole } from '../../../generated/prisma/enums.js';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
const ROLES = Object.values(UserRole);

const PASSWORD_MESSAGE = `la contraseña debe tener entre ${PASSWORD_MIN_LENGTH} y ${PASSWORD_MAX_LENGTH} caracteres`;
const NAME_MESSAGE = 'name debe tener entre 2 y 120 caracteres';
const ROLE_MESSAGE = `role debe ser uno de: ${ROLES.join(', ')}`;

/** A new password: 12-128 characters. */
export const IsNewPassword = (): PropertyDecorator => (target, key) => {
  IsString({ message: PASSWORD_MESSAGE })(target, key);
  Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, {
    message: PASSWORD_MESSAGE,
  })(target, key);
};

/** `POST /admin/users` */
export class CreateUserDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'email debe ser un email válido' })
  @MaxLength(254)
  email: string;

  @Trim()
  @IsString({ message: NAME_MESSAGE })
  @Length(2, 120, { message: NAME_MESSAGE })
  name: string;

  @IsIn(ROLES, { message: ROLE_MESSAGE })
  role: UserRole;

  @IsNewPassword()
  password: string;
}

/** `PATCH /admin/users/:id` */
export class UpdateUserDto {
  @IsOptionalNonNull()
  @Trim()
  @IsString({ message: NAME_MESSAGE })
  @Length(2, 120, { message: NAME_MESSAGE })
  name?: string;

  @IsOptionalNonNull()
  @IsIn(ROLES, { message: ROLE_MESSAGE })
  role?: UserRole;

  @IsOptionalNonNull()
  @IsBoolean({ message: 'isActive debe ser true o false' })
  isActive?: boolean;
}

/** `POST /admin/users/:id/password` */
export class SetPasswordDto {
  @IsNewPassword()
  password: string;
}
