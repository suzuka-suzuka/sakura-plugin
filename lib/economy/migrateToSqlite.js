
import fs from 'fs';
import path from 'path';
import { plugindata } from '../path.js';
import db from '../Database.js';

const migrate = () => {
    const economyDir = path.join(plugindata, 'economy');
    const inventoryDir = path.join(plugindata, 'economy', 'inventory');
    const fishingDir = path.join(plugindata, 'economy', 'fishing');
    const favorabilityDir = path.join(plugindata, 'favorability');
    const buffDir = path.join(plugindata, 'economy', 'buffs');

    console.log('Starting migration...');
    const transaction = db.transaction(() => {
        // 1. Migrate Economy
        if (fs.existsSync(economyDir)) {
            const files = fs.readdirSync(economyDir).filter(f => f.endsWith('.json'));

            // 建议：把 prepare 放在循环外面，性能会快很多
            const insertEconomy = db.prepare(`
                INSERT OR REPLACE INTO economy (group_id, user_id, coins, experience, level, bag_level)
                VALUES (?, ?, ?, ?, ?, ?)
            `);

            for (const file of files) {
                const groupId = path.basename(file, '.json');
                const filePath = path.join(economyDir, file);
                try {
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    for (const [userId, userData] of Object.entries(data)) {
                        // 使用定义好的 insertEconomy
                        insertEconomy.run(
                            groupId,
                            userId,
                            userData.coins || 0,
                            userData.experience || 0,
                            userData.level || 1,
                            userData.bag_level || 1
                        );
                    }
                } catch (err) {
                    console.error(`Error migrating economy file ${file}:`, err);
                }
            }
            console.log('Economy migration completed.');
        }

        // 2. Migrate Inventory
        if (fs.existsSync(inventoryDir)) {
            const files = fs.readdirSync(inventoryDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                const groupId = path.basename(file, '.json');
                const filePath = path.join(inventoryDir, file);
                try {
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    for (const [userId, userInventory] of Object.entries(data)) {
                        for (const [itemId, count] of Object.entries(userInventory)) {
                            db.prepare(`
                                INSERT OR REPLACE INTO inventory (group_id, user_id, item_id, count)
                                VALUES (?, ?, ?, ?)
                            `).run(groupId, userId, itemId, count);
                        }
                    }
                } catch (err) {
                    console.error(`Error migrating inventory file ${file}:`, err);
                }
            }
            console.log('Inventory migration completed.');
        }

        // 3. Migrate Fishing
        if (fs.existsSync(fishingDir)) {
            const files = fs.readdirSync(fishingDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                const groupId = path.basename(file, '.json');
                const filePath = path.join(fishingDir, file);
                try {
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

                    // Pond Torpedoes (special key starting with _)
                    if (data._pondTorpedoes) {
                        for (const [userId, timestamp] of Object.entries(data._pondTorpedoes)) {
                            db.prepare(`
                                 INSERT OR REPLACE INTO pond_torpedoes (group_id, user_id, timestamp)
                                 VALUES (?, ?, ?)
                             `).run(groupId, userId, timestamp);
                        }
                    }

                    for (const [userId, userData] of Object.entries(data)) {
                        if (userId.startsWith('_')) continue; // Skip metadata

                        // Fishing Stats
                        db.prepare(`
                            INSERT OR REPLACE INTO fishing_stats (
                                group_id, user_id, rod, line, bait, total_catch, total_earnings, torpedo_hits, profession, profession_level
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `).run(
                            groupId,
                            userId,
                            userData.rod || null,
                            userData.line || null,
                            userData.bait || null,
                            userData.totalCatch || 0,
                            userData.totalEarnings || 0,
                            userData.torpedoHits || 0,
                            userData.profession || null,
                            userData.professionLevel || 0
                        );

                        // Fish Counts
                        if (userData.fishCounts) {
                            for (const [fishId, stats] of Object.entries(userData.fishCounts)) {
                                db.prepare(`
                                    INSERT OR REPLACE INTO fishing_counts (group_id, user_id, fish_id, count, success_count)
                                    VALUES (?, ?, ?, ?, ?)
                                `).run(groupId, userId, fishId, stats.count || 0, stats.successCount || 0);
                            }
                        }

                        // Rod Stats (Damage & Mastery)
                        // We need to merge rodDamage and rodMastery
                        const rodIds = new Set([
                            ...Object.keys(userData.rodDamage || {}),
                            ...Object.keys(userData.rodMastery || {})
                        ]);

                        for (const rodId of rodIds) {
                            const damage = (userData.rodDamage && userData.rodDamage[rodId]) || 0;
                            const mastery = (userData.rodMastery && userData.rodMastery[rodId]) || 0;
                            db.prepare(`
                                INSERT OR REPLACE INTO rod_stats (group_id, user_id, rod_id, damage, mastery)
                                VALUES (?, ?, ?, ?, ?)
                            `).run(groupId, userId, rodId, damage, mastery);
                        }
                    }
                } catch (err) {
                    console.error(`Error migrating fishing file ${file}:`, err);
                }
            }
            console.log('Fishing migration completed.');
        }

        // 4. Migrate Favorability
        if (fs.existsSync(favorabilityDir)) {
            const files = fs.readdirSync(favorabilityDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                const groupId = path.basename(file, '.json');
                const filePath = path.join(favorabilityDir, file);
                try {
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    if (data.favorability) {
                        for (const [fromId, toData] of Object.entries(data.favorability)) {
                            for (const [toId, value] of Object.entries(toData)) {
                                db.prepare(`
                                    INSERT OR REPLACE INTO favorability (group_id, from_user_id, to_user_id, value)
                                    VALUES (?, ?, ?, ?)
                                `).run(groupId, fromId, toId, value);
                            }
                        }
                    }
                } catch (err) {
                    console.error(`Error migrating favorability file ${file}:`, err);
                }
            }
            console.log('Favorability migration completed.');
        }

        // 5. Migrate Buffs
        if (fs.existsSync(buffDir)) {
            const files = fs.readdirSync(buffDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                const groupId = path.basename(file, '.json');
                const filePath = path.join(buffDir, file);
                try {
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    for (const [userId, userBuffs] of Object.entries(data)) {
                        for (const [buffId, buffData] of Object.entries(userBuffs)) {
                            db.prepare(`
                                INSERT OR REPLACE INTO user_buffs (group_id, user_id, buff_id, name, effect, activated_at, expire_time)
                                VALUES (?, ?, ?, ?, ?, ?, ?)
                            `).run(
                                groupId,
                                userId,
                                buffId,
                                buffData.name,
                                JSON.stringify(buffData.effect),
                                buffData.activatedAt,
                                buffData.expireTime
                            );
                        }
                    }
                } catch (err) {
                    console.error(`Error migrating buff file ${file}:`, err);
                }
            }
            console.log('Buff migration completed.');
        }
    });

    transaction();
    console.log('All migrations completed successfully.');
};

export default migrate;
