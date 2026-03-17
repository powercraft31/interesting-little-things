import bcrypt from "bcryptjs";
import { Pool } from "pg";

const SEED_USERS = [
  {
    userId: "USER_ADMIN_001",
    email: "admin@solfacil.com.br",
    name: "Solfacil Admin",
    orgId: "ORG_ENERGIA_001",
    role: "SOLFACIL_ADMIN",
    password: "solfacil2026",
  },
  {
    userId: "USER_ALAN_001",
    email: "alan@xuheng.com",
    name: "Alan Xu",
    orgId: "ORG_DEMO_001",
    role: "ORG_MANAGER",
    password: "solfacil2026",
  },
] as const;

export async function seedUsers(pool: Pool): Promise<void> {
  for (const u of SEED_USERS) {
    const hashedPassword = await bcrypt.hash(u.password, 12);
    await pool.query(
      `INSERT INTO users (user_id, email, name, hashed_password, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (user_id) DO UPDATE SET
         hashed_password = EXCLUDED.hashed_password,
         updated_at = NOW()`,
      [u.userId, u.email, u.name, hashedPassword],
    );
    await pool.query(
      `INSERT INTO user_org_roles (user_id, org_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, org_id) DO UPDATE SET role = EXCLUDED.role`,
      [u.userId, u.orgId, u.role],
    );
  }
  console.log(`[seed] Seeded ${SEED_USERS.length} users`);
}

// Run directly if executed as script
if (require.main === module) {
  const pool = new Pool({
    connectionString:
      process.env.SERVICE_DATABASE_URL ??
      process.env.DATABASE_URL ??
      "postgresql://solfacil_service:solfacil_service_2026@localhost:5432/solfacil_vpp",
  });

  seedUsers(pool)
    .then(() => {
      console.log("[seed] Done");
      return pool.end();
    })
    .catch((err) => {
      console.error("[seed] Failed:", err);
      process.exit(1);
    });
}
