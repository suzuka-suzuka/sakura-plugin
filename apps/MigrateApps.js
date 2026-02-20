import migrateImageMetadata from '../lib/economy/migrateImageMetadata.js';
import migrateToSqlite from '../lib/economy/migrateToSqlite.js';

export class MigrateApps extends plugin {
    constructor() {
        super({
            name: 'Sakura数据迁移',
            priority: 500
        });
    }

    runMigrations = Command(/^#*(执行)?sakura数据迁移$/, 'master', async (e) => {
        await e.reply('开始执行数据迁移...');

        try {
            migrateToSqlite();
            migrateImageMetadata();
            await e.reply('数据迁移执行完毕，请查看控制台日志以确认详情。');
        } catch (err) {
            console.error('Migration error:', err);
            await e.reply('数据迁移执行失败，请查看控制台日志。');
        }

        return true;
    });
}
