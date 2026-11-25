import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsNewPassword } from '../../users/dto/user.dto.js';

/** `POST /auth/password` */
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  currentPassword: string;

  /** 12-128 characters, different from the current one (checked by the service). */
  @IsNewPassword()
  newPassword: string;
}
