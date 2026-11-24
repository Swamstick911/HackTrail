import { betterAuth } from 'better-auth';
import { username } from 'better-auth/plugins';
import { getMigrations } from 'better-auth/db/migration';
import { DatabaseSync } from 'node:sqlite';
import nodemailer from 'nodemailer';

export interface AuthOptions {
  databasePath: string;
  origin: string;
  secret: string;
  smtpUrl?: string;
  mailFrom?: string;
  registrationOpen?: boolean;
  onDeleteAccount: (id: string) => void;
}

export async function createAuthentication(options: AuthOptions) {
  const database = new DatabaseSync(options.databasePath);
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const mail = options.smtpUrl ? nodemailer.createTransport(options.smtpUrl) : undefined;
  const send = async (to: string, subject: string, url: string) => {
    if (!mail || !options.mailFrom) throw new Error('Account email is not configured.');
    await mail.sendMail({
      from: options.mailFrom,
      to,
      subject,
      text: subject + '\n\n' + url + '\n\nIf you did not request this, ignore this email.',
    });
  };
  const auth = betterAuth({
    appName: 'HackTrail',
    database,
    baseURL: options.origin,
    secret: options.secret,
    trustedOrigins: [options.origin],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: Boolean(mail),
      disableSignUp: options.registrationOpen === false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: mail
        ? async ({ user, url }) => send(user.email, 'Reset your HackTrail password', url)
        : undefined,
    },
    emailVerification: mail
      ? {
          sendOnSignUp: true,
          sendOnSignIn: true,
          autoSignInAfterVerification: true,
          sendVerificationEmail: async ({ user, url }) =>
            send(user.email, 'Verify your HackTrail email', url),
        }
      : undefined,
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    user: {
      deleteUser: { enabled: true, beforeDelete: async (user) => options.onDeleteAccount(user.id) },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-up/email': { window: 60, max: 5 },
        '/sign-in/*': { window: 60, max: 10 },
        '/request-password-reset': { window: 60, max: 3 },
      },
    },
    advanced: {
      cookiePrefix: 'hacktrail',
      useSecureCookies: options.origin.startsWith('https:'),
      ipAddress: { ipAddressHeaders: ['x-hacktrail-client-ip'] },
    },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 32,
        usernameValidator: (value) => /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value),
      }),
    ],
  });
  try {
    const migration = await getMigrations(auth.options);
    await migration.runMigrations();
    return {
      auth,
      close: () => {
        mail?.close();
        database.close();
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
export type Authentication = Awaited<ReturnType<typeof createAuthentication>>;
