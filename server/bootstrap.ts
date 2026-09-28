import { db } from './db';
import { roles, users, mbtDocumentFiles, mbtDocumentAnalyses } from '@shared/schema';
import bcrypt from 'bcryptjs';
import { eq, lt, sql } from 'drizzle-orm';
import { log } from './vite';

export async function bootstrap() {
  log('Bootstrapping database...');

  // Ensure admin role exists
  let adminRole = await db.select().from(roles).where(eq(roles.name, 'admin')).then(r => r[0]);
  if (!adminRole) {
    const [created] = await db.insert(roles).values({
      name: 'admin',
      permissions: ['*'],
      description: 'System administrator',
    }).returning();
    adminRole = created;
    log('Created admin role');
  }

  // Ensure user role exists
  let userRole = await db.select().from(roles).where(eq(roles.name, 'user')).then(r => r[0]);
  if (!userRole) {
    const [created] = await db.insert(roles).values({
      name: 'user',
      permissions: [],
      description: 'Regular user',
    }).returning();
    userRole = created;
    log('Created user role');
  }

  // Ensure default admin user exists
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@mbt.local';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

  const existingAdmin = await db.select().from(users).where(eq(users.email, adminEmail)).then(r => r[0]);
  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    await db.insert(users).values({
      username: 'admin',
      email: adminEmail,
      passwordHash,
      roleId: adminRole.id,
      isActive: true,
    });
    log(`Created default admin user: ${adminEmail} / ${adminPassword}`);
    log('IMPORTANT: Change the admin password after first login!');
  }

  // Reset any jobs left in 'processing' state from a previous server run.
  // These are ghost tasks — the process that was running them died on restart.
  const stuckAnalysis = await db
    .select({ id: mbtDocumentFiles.id })
    .from(mbtDocumentFiles)
    .where(eq(mbtDocumentFiles.analysisStatus, 'processing'));

  if (stuckAnalysis.length > 0) {
    await db
      .update(mbtDocumentFiles)
      .set({ analysisStatus: 'pending' as const })
      .where(eq(mbtDocumentFiles.analysisStatus, 'processing'));
    log(`Cleanup: reset ${stuckAnalysis.length} stuck analysis job(s)`);
  }

  const stuckExtraction = await db
    .select({ id: mbtDocumentFiles.id })
    .from(mbtDocumentFiles)
    .where(eq(mbtDocumentFiles.extractionStatus, 'processing'));

  if (stuckExtraction.length > 0) {
    await db
      .update(mbtDocumentFiles)
      .set({ extractionStatus: 'pending' as const })
      .where(eq(mbtDocumentFiles.extractionStatus, 'processing'));
    log(`Cleanup: reset ${stuckExtraction.length} stuck extraction job(s)`);
  }

  log('Bootstrap complete');
}
