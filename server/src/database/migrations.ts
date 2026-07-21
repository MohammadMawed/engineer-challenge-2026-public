import type BetterSqlite3 from 'better-sqlite3'
import { hashPassword, isPasswordHash, verifyPassword } from '../services/password.service'

type Database = BetterSqlite3.Database

type Migration = {
  version: number
  name: string
  up: (db: Database) => void
}

function tableHasColumn(db: Database, table: string, column: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return columns.some((entry) => entry.name === column)
}

function addColumn(db: Database, table: string, column: string, definition: string) {
  if (!tableHasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'create_core_schema',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL UNIQUE,
          password TEXT NOT NULL,
          name TEXT NOT NULL,
          role TEXT NOT NULL CONSTRAINT users_role_check CHECK (role IN ('agent', 'manager'))
        );

        CREATE TABLE IF NOT EXISTS customers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          plan TEXT NOT NULL,
          health_score INTEGER NOT NULL CONSTRAINT customers_health_check CHECK (health_score BETWEEN 0 AND 100)
        );

        CREATE TABLE IF NOT EXISTS feedback (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
          channel TEXT NOT NULL CONSTRAINT feedback_channel_check CHECK (channel IN ('email', 'chat', 'app store')),
          message TEXT NOT NULL,
          status TEXT NOT NULL CONSTRAINT feedback_status_check CHECK (status IN ('open', 'resolved')),
          priority TEXT NOT NULL CONSTRAINT feedback_priority_check CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
          priority_source TEXT CONSTRAINT feedback_priority_source_check CHECK (priority_source IS NULL OR priority_source IN ('ai', 'human')),
          priority_reason TEXT,
          priority_updated_at TEXT,
          category TEXT NOT NULL DEFAULT 'other' CONSTRAINT feedback_category_check CHECK (category IN ('praise', 'bug', 'billing', 'outage', 'feature_request', 'question', 'other')),
          tags TEXT NOT NULL DEFAULT '[]' CONSTRAINT feedback_tags_check CHECK (json_valid(tags) AND json_type(tags) = 'array'),
          duplicate_of_id INTEGER REFERENCES feedback(id) ON DELETE SET NULL CONSTRAINT feedback_duplicate_check CHECK (duplicate_of_id IS NULL OR duplicate_of_id <> id),
          escalation_status TEXT NOT NULL DEFAULT 'none' CONSTRAINT feedback_escalation_check CHECK (escalation_status IN ('none', 'pending', 'approved', 'rejected')),
          escalation_reason TEXT,
          assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          due_at TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS feedback_notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          feedback_id INTEGER NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
          author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          body TEXT NOT NULL,
          is_private INTEGER NOT NULL CONSTRAINT notes_private_check CHECK (is_private IN (0, 1)),
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS feedback_activity (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          feedback_id INTEGER NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
          actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          action TEXT NOT NULL,
          details TEXT NOT NULL CONSTRAINT activity_details_check CHECK (json_valid(details)),
          created_at TEXT NOT NULL
        );
      `)
    },
  },
  {
    version: 2,
    name: 'add_feedback_workflow_fields',
    up(db) {
      addColumn(db, 'feedback', 'priority_source', 'TEXT')
      addColumn(db, 'feedback', 'priority_reason', 'TEXT')
      addColumn(db, 'feedback', 'priority_updated_at', 'TEXT')
      addColumn(db, 'feedback', 'category', "TEXT NOT NULL DEFAULT 'other'")
      addColumn(db, 'feedback', 'tags', "TEXT NOT NULL DEFAULT '[]'")
      addColumn(db, 'feedback', 'duplicate_of_id', 'INTEGER')
      addColumn(db, 'feedback', 'escalation_status', "TEXT NOT NULL DEFAULT 'none'")
      addColumn(db, 'feedback', 'escalation_reason', 'TEXT')
    },
  },
  {
    version: 3,
    name: 'rebuild_legacy_tables_with_integrity_constraints',
    up(db) {
      const feedbackDefinition = db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'feedback'")
        .get() as { sql: string } | undefined
      if (feedbackDefinition?.sql.includes('feedback_status_check')) return

      db.exec(`
        CREATE TABLE users_migrated (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL UNIQUE,
          password TEXT NOT NULL,
          name TEXT NOT NULL,
          role TEXT NOT NULL CONSTRAINT users_role_check CHECK (role IN ('agent', 'manager'))
        );
        INSERT INTO users_migrated SELECT id, email, password, name, role FROM users;

        CREATE TABLE customers_migrated (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          plan TEXT NOT NULL,
          health_score INTEGER NOT NULL CONSTRAINT customers_health_check CHECK (health_score BETWEEN 0 AND 100)
        );
        INSERT INTO customers_migrated SELECT id, name, email, plan, health_score FROM customers;

        CREATE TABLE feedback_migrated (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_id INTEGER NOT NULL REFERENCES customers_migrated(id) ON DELETE RESTRICT,
          channel TEXT NOT NULL CONSTRAINT feedback_channel_check CHECK (channel IN ('email', 'chat', 'app store')),
          message TEXT NOT NULL,
          status TEXT NOT NULL CONSTRAINT feedback_status_check CHECK (status IN ('open', 'resolved')),
          priority TEXT NOT NULL CONSTRAINT feedback_priority_check CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
          priority_source TEXT CONSTRAINT feedback_priority_source_check CHECK (priority_source IS NULL OR priority_source IN ('ai', 'human')),
          priority_reason TEXT,
          priority_updated_at TEXT,
          category TEXT NOT NULL DEFAULT 'other' CONSTRAINT feedback_category_check CHECK (category IN ('praise', 'bug', 'billing', 'outage', 'feature_request', 'question', 'other')),
          tags TEXT NOT NULL DEFAULT '[]' CONSTRAINT feedback_tags_check CHECK (json_valid(tags) AND json_type(tags) = 'array'),
          duplicate_of_id INTEGER REFERENCES feedback_migrated(id) ON DELETE SET NULL CONSTRAINT feedback_duplicate_check CHECK (duplicate_of_id IS NULL OR duplicate_of_id <> id),
          escalation_status TEXT NOT NULL DEFAULT 'none' CONSTRAINT feedback_escalation_check CHECK (escalation_status IN ('none', 'pending', 'approved', 'rejected')),
          escalation_reason TEXT,
          assignee_id INTEGER REFERENCES users_migrated(id) ON DELETE SET NULL,
          due_at TEXT,
          created_at TEXT NOT NULL
        );
        INSERT INTO feedback_migrated
          SELECT id, customer_id, channel, message, status, priority, priority_source, priority_reason,
                 priority_updated_at, category, tags, duplicate_of_id, escalation_status,
                 escalation_reason, assignee_id, due_at, created_at
          FROM feedback;

        CREATE TABLE feedback_notes_migrated (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          feedback_id INTEGER NOT NULL REFERENCES feedback_migrated(id) ON DELETE CASCADE,
          author_id INTEGER NOT NULL REFERENCES users_migrated(id) ON DELETE RESTRICT,
          body TEXT NOT NULL,
          is_private INTEGER NOT NULL CONSTRAINT notes_private_check CHECK (is_private IN (0, 1)),
          created_at TEXT NOT NULL
        );
        INSERT INTO feedback_notes_migrated
          SELECT n.id, n.feedback_id, n.author_id, n.body, n.is_private, n.created_at
          FROM feedback_notes n
          JOIN feedback f ON f.id = n.feedback_id
          JOIN users u ON u.id = n.author_id;

        CREATE TABLE feedback_activity_migrated (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          feedback_id INTEGER NOT NULL REFERENCES feedback_migrated(id) ON DELETE CASCADE,
          actor_id INTEGER REFERENCES users_migrated(id) ON DELETE SET NULL,
          action TEXT NOT NULL,
          details TEXT NOT NULL CONSTRAINT activity_details_check CHECK (json_valid(details)),
          created_at TEXT NOT NULL
        );
        INSERT INTO feedback_activity_migrated
          SELECT a.id, a.feedback_id,
                 CASE WHEN u.id IS NULL THEN NULL ELSE a.actor_id END,
                 a.action, a.details, a.created_at
          FROM feedback_activity a
          JOIN feedback f ON f.id = a.feedback_id
          LEFT JOIN users u ON u.id = a.actor_id;

        DROP TABLE feedback_activity;
        DROP TABLE feedback_notes;
        DROP TABLE feedback;
        DROP TABLE customers;
        DROP TABLE users;

        ALTER TABLE users_migrated RENAME TO users;
        ALTER TABLE customers_migrated RENAME TO customers;
        ALTER TABLE feedback_migrated RENAME TO feedback;
        ALTER TABLE feedback_notes_migrated RENAME TO feedback_notes;
        ALTER TABLE feedback_activity_migrated RENAME TO feedback_activity;
      `)
    },
  },
  {
    version: 4,
    name: 'create_cache_and_indexes',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS priority_cache (
          cache_key TEXT PRIMARY KEY,
          priority TEXT NOT NULL CONSTRAINT cache_priority_check CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
          reason TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_feedback_status_created ON feedback(status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_feedback_assignee ON feedback(assignee_id);
        CREATE INDEX IF NOT EXISTS idx_feedback_priority ON feedback(priority);
        CREATE INDEX IF NOT EXISTS idx_feedback_customer ON feedback(customer_id);
        CREATE INDEX IF NOT EXISTS idx_feedback_due ON feedback(status, due_at);
        CREATE INDEX IF NOT EXISTS idx_notes_feedback_private ON feedback_notes(feedback_id, is_private, author_id);
        CREATE INDEX IF NOT EXISTS idx_activity_feedback ON feedback_activity(feedback_id, created_at DESC);
      `)
    },
  },
  {
    version: 5,
    name: 'create_agent_assist_cache',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_assist_cache (
          cache_key TEXT PRIMARY KEY,
          feedback_id INTEGER NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
          recommendation TEXT NOT NULL CONSTRAINT assist_recommendation_check CHECK (json_valid(recommendation)),
          model TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_agent_assist_feedback ON agent_assist_cache(feedback_id, created_at DESC);
      `)
    },
  },
  {
    version: 6,
    name: 'create_feedback_search_index',
    up(db) {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS feedback_search
        USING fts5(message, content='feedback', content_rowid='id');

        INSERT INTO feedback_search(feedback_search) VALUES('rebuild');

        CREATE TRIGGER IF NOT EXISTS feedback_search_insert
        AFTER INSERT ON feedback BEGIN
          INSERT INTO feedback_search(rowid, message) VALUES (new.id, new.message);
        END;

        CREATE TRIGGER IF NOT EXISTS feedback_search_delete
        AFTER DELETE ON feedback BEGIN
          INSERT INTO feedback_search(feedback_search, rowid, message)
          VALUES ('delete', old.id, old.message);
        END;

        CREATE TRIGGER IF NOT EXISTS feedback_search_update
        AFTER UPDATE OF message ON feedback BEGIN
          INSERT INTO feedback_search(feedback_search, rowid, message)
          VALUES ('delete', old.id, old.message);
          INSERT INTO feedback_search(rowid, message) VALUES (new.id, new.message);
        END;
      `)
    },
  },
  {
    version: 7,
    name: 'secure_authentication_storage',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS auth_sessions (
          jti TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at TEXT NOT NULL,
          revoked_at TEXT,
          created_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS auth_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event TEXT NOT NULL,
          email TEXT,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          ip_address TEXT NOT NULL,
          user_agent TEXT,
          details TEXT NOT NULL CONSTRAINT auth_event_details_check CHECK (json_valid(details)),
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS auth_login_limits (
          scope TEXT NOT NULL,
          subject TEXT NOT NULL,
          attempts INTEGER NOT NULL,
          window_started_at TEXT NOT NULL,
          blocked_until TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (scope, subject)
        );

        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          used_at TEXT,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id, expires_at);
        CREATE INDEX IF NOT EXISTS idx_auth_events_user_created ON auth_events(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_auth_events_email_created ON auth_events(email, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id, created_at DESC);
      `)

      const users = db.prepare('SELECT id, password FROM users').all() as Array<{ id: number; password: string }>
      const updatePassword = db.prepare('UPDATE users SET password = ? WHERE id = ?')
      for (const user of users) {
        if (!isPasswordHash(user.password)) updatePassword.run(hashPassword(user.password), user.id)
      }
    },
  },
  {
    version: 8,
    name: 'rotate_demo_credentials',
    up(db) {
      const demoCredentials = [
        { email: 'alice@pulse.test', previous: 'password123', next: 'PulseAgent2026!' },
        { email: 'ben@pulse.test', previous: 'support42', next: 'PulseManager2026!' },
        { email: 'chloe@pulse.test', previous: 'welcome1', next: 'PulseChloe2026!' },
      ]
      const findUser = db.prepare('SELECT id, password FROM users WHERE email = ?')
      const updatePassword = db.prepare('UPDATE users SET password = ? WHERE id = ?')
      for (const credential of demoCredentials) {
        const user = findUser.get(credential.email) as { id: number; password: string } | undefined
        if (user && verifyPassword(credential.previous, user.password)) {
          updatePassword.run(hashPassword(credential.next), user.id)
        }
      }
    },
  },
]

export function runMigrations(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map((row) => row.version)
  )
  const record = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue
    db.transaction(() => {
      migration.up(db)
      record.run(migration.version, migration.name, new Date().toISOString())
    })()
  }
}
