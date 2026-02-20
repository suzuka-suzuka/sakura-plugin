import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { plugindata } from './path.js';

class DB {
  constructor() {
    this.dbPath = path.join(plugindata, 'sakura.sqlite');

    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS economy (
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        coins INTEGER DEFAULT 0,
        experience INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1,
        bag_level INTEGER DEFAULT 1,
        PRIMARY KEY (group_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS inventory (
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        count INTEGER DEFAULT 0,
        PRIMARY KEY (group_id, user_id, item_id)
      );

      CREATE TABLE IF NOT EXISTS fishing_stats (
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        rod TEXT,
        line TEXT,
        bait TEXT,
        total_catch INTEGER DEFAULT 0,
        total_earnings INTEGER DEFAULT 0,
        torpedo_hits INTEGER DEFAULT 0,
        profession TEXT,
        profession_level INTEGER DEFAULT 0,
        PRIMARY KEY (group_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS fishing_counts (
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        fish_id TEXT NOT NULL,
        count INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        PRIMARY KEY (group_id, user_id, fish_id)
      );

      CREATE TABLE IF NOT EXISTS rod_stats (
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        rod_id TEXT NOT NULL,
        damage INTEGER DEFAULT 0,
        mastery INTEGER DEFAULT 0,
        PRIMARY KEY (group_id, user_id, rod_id)
      );

      CREATE TABLE IF NOT EXISTS pond_torpedoes (
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        timestamp INTEGER,
        PRIMARY KEY (group_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS favorability (
        group_id TEXT NOT NULL,
        from_user_id TEXT NOT NULL,
        to_user_id TEXT NOT NULL,
        value INTEGER DEFAULT 0,
        PRIMARY KEY (group_id, from_user_id, to_user_id)
      );
      
      CREATE TABLE IF NOT EXISTS user_buffs (
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        buff_id TEXT NOT NULL,
        name TEXT,
        effect TEXT,
        activated_at INTEGER,
        expire_time INTEGER,
        PRIMARY KEY (group_id, user_id, buff_id)
      );

      CREATE TABLE IF NOT EXISTS image_metadata (
        id TEXT PRIMARY KEY,
        hash TEXT NOT NULL UNIQUE,
        file_path TEXT,
        file_name TEXT,
        description TEXT,
        metadata TEXT,
        created_at INTEGER
      );
    `);

    this.fixTypes();
  }

  fixTypes() {
    const tables = ['fishing_stats', 'fishing_counts', 'rod_stats', 'pond_torpedoes', 'economy', 'inventory'];
    let totalFixed = 0;

    for (const table of tables) {
      try {
        const badRows = this.db.prepare(
          `SELECT rowid, user_id, group_id FROM ${table} WHERE typeof(user_id) != 'text' OR typeof(group_id) != 'text'`
        ).all();

        if (badRows.length === 0) continue;

        for (const row of badRows) {
          const fixedUserId = String(Math.round(Number(row.user_id)));
          const fixedGroupId = String(Math.round(Number(row.group_id)));

          try {
            this.db.prepare(`UPDATE ${table} SET user_id = ?, group_id = ? WHERE rowid = ?`)
              .run(fixedUserId, fixedGroupId, row.rowid);
            totalFixed++;
          } catch (e) {
            // PRIMARY KEY conflict - duplicate exists, delete this row
            this.db.prepare(`DELETE FROM ${table} WHERE rowid = ?`).run(row.rowid);
            totalFixed++;
          }
        }
      } catch (e) {
        // Table might not exist yet, skip
      }
    }

    if (totalFixed > 0) {
      console.log(`[Database] Fixed ${totalFixed} rows with non-text IDs`);
    }
  }

  prepare(sql) {
    return this.db.prepare(sql);
  }

  transaction(fn) {
    return this.db.transaction(fn);
  }
}

export default new DB();
