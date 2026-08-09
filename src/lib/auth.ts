import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { brandMembers, brands, sessions, users, type Brand, type User } from "@/db/schema";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SESSION_COOKIE = "roas_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;
  const key = await scrypt(password, Buffer.from(saltHex, "hex"), KEY_LENGTH);
  const expected = Buffer.from(keyHex, "hex");
  // Length check first: timingSafeEqual throws on mismatched lengths.
  if (expected.length !== key.length) return false;
  return timingSafeEqual(key, expected);
}

export interface Principal {
  user: User;
  brand: Brand;
}

export async function createSession(userId: string): Promise<string> {
  const [session] = await db
    .insert(sessions)
    .values({ userId, expiresAt: Date.now() + SESSION_TTL_MS })
    .returning();

  const jar = await cookies();
  jar.set(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: "lax",
    // Dev runs over plain http on localhost; a Secure cookie would never be sent back.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return session.id;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (id) await db.delete(sessions).where(eq(sessions.id, id)).run();
  jar.delete(SESSION_COOKIE);
}

/** Resolve the signed-in user and their brand, or null. Never throws. */
export async function getPrincipal(): Promise<Principal | null> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (!id) return null;

  const row = await db
    .select({ user: users, brand: brands })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .innerJoin(brands, eq(users.brandId, brands.id))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, Date.now())))
    .get();

  return row ?? null;
}

/**
 * For pages and API routes that must have a principal. Callers in `app/(app)` can rely on
 * the layout having redirected, but API routes need this to enforce tenancy.
 */
export async function requirePrincipal(): Promise<Principal> {
  const principal = await getPrincipal();
  if (!principal) throw new UnauthorizedError();
  return principal;
}

/**
 * Every brand this user may read, home brand first.
 *
 * The home brand is always included regardless of membership rows, so a single-brand tenant
 * needs no data migration and a cross-brand view simply shows one row. Any page that cuts
 * across brands must source its brand list from here — never from an unfiltered `brands`
 * query, which would leak another tenant's numbers.
 */
export async function accessibleBrands(principal: Principal): Promise<Brand[]> {
  const rows = await db
    .select({ brand: brands })
    .from(brandMembers)
    .innerJoin(brands, eq(brandMembers.brandId, brands.id))
    .where(eq(brandMembers.userId, principal.user.id));

  const byId = new Map<string, Brand>([[principal.brand.id, principal.brand]]);
  for (const row of rows) byId.set(row.brand.id, row.brand);

  return [...byId.values()].sort((a, b) =>
    a.id === principal.brand.id ? -1 : b.id === principal.brand.id ? 1 : a.name.localeCompare(b.name),
  );
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "UnauthorizedError";
  }
}

export async function authenticate(
  email: string,
  password: string,
): Promise<Principal | null> {
  const row = await db
    .select({ user: users, brand: brands })
    .from(users)
    .innerJoin(brands, eq(users.brandId, brands.id))
    .where(eq(users.email, email.toLowerCase().trim()))
    .get();

  // Hash even when the user doesn't exist so a missing account and a wrong password take
  // the same time and can't be told apart.
  const stored = row?.user.passwordHash ?? (await hashPassword("dummy-password"));
  const ok = await verifyPassword(password, stored);
  return ok && row ? row : null;
}
