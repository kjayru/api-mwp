import { Injectable } from '@nestjs/common';
import {
  DEFAULT_SCRYPT_PARAMS,
  hashPassword,
  needsRehash,
  type ScryptParams,
  verifyPassword,
} from './scrypt.js';

/** Password hashing with node:crypto scrypt. Format: `scrypt$N$r$p$salt$hash`. */
@Injectable()
export class PasswordService {
  private readonly params: ScryptParams = DEFAULT_SCRYPT_PARAMS;

  hash(password: string): Promise<string> {
    return hashPassword(password, this.params);
  }

  verify(password: string, hash: string): Promise<boolean> {
    return verifyPassword(password, hash);
  }

  needsRehash(hash: string): boolean {
    return needsRehash(hash, this.params);
  }
}
