
import fs from 'fs';
import path from 'path';
import { plugindata } from '../path.js';
import db from '../Database.js';

const migrate = () => {
    const EMOJI_DATA_DIR = path.join(plugindata, "emoji_embeddings");
    const METADATA_PATH = path.join(EMOJI_DATA_DIR, "metadata.json");

    console.log('Starting Image Metadata migration...');
    const transaction = db.transaction(() => {
        if (fs.existsSync(METADATA_PATH)) {
            try {
                const data = fs.readFileSync(METADATA_PATH, 'utf-8');
                const schema = JSON.parse(data);

                let migratedCount = 0;

                for (const item of schema) {
                    // Check if already exists to avoid duplicates
                    const existing = db.prepare('SELECT 1 FROM image_metadata WHERE hash = ?').get(item.hash);
                    if (existing) continue;

                    db.prepare(`
                        INSERT INTO image_metadata (id, hash, file_path, file_name, description, metadata, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `).run(
                        item.id,
                        item.hash,
                        item.localPath,
                        item.filename,
                        item.description,
                        JSON.stringify(item.metadata || {}),
                        new Date(item.metadata?.createdAt || Date.now()).getTime()
                    );
                    migratedCount++;
                }
                console.log(`Image Metadata migration completed. Migrated ${migratedCount} items.`);
            } catch (err) {
                console.error(`Error migrating image metadata:`, err);
            }
        } else {
            console.log('No metadata.json found, skipping migration.');
        }
    });

    transaction();
    console.log('Migration process finished.');
};

export default migrate;
