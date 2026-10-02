// Sets a user's password and closes all of their sessions.
//
//   NEW_PASSWORD='...' npm run user:set-password -- admin@miwebprofesional.com
//
// The password is read from NEW_PASSWORD (not from argv) so it doesn't end up in the
// process list. Runs with Node's native type stripping, like the seed.
import '../src/config/load-env.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { hashPassword } from '../src/modules/auth/scrypt.js';

const MIN_PASSWORD_LENGTH = 8;

const email = process.argv[2]?.trim().toLowerCase();
const password = process.env.NEW_PASSWORD ?? '';

if (!email) {
  console.error('Usage: NEW_PASSWORD=... npm run user:set-password -- <email>');
  process.exit(1);
}
if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(
    `NEW_PASSWORD is required (at least ${MIN_PASSWORD_LENGTH} characters).`,
  );
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

try {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`User ${email} not found.`);
    process.exitCode = 1;
  } else {
    await prisma.$transaction([
      prisma.user.update({
        where: { email },
        data: { passwordHash: await hashPassword(password) },
      }),
      prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    console.log(`Password updated for ${email}; active sessions revoked.`);
  }
} finally {
  await prisma.$disconnect();
}
