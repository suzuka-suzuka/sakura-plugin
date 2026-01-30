import fs from "node:fs"
import path from "node:path"
import { plugindata } from "../lib/path.js"

const SOURCE_GROUP = 1040045728
const TARGET_GROUP = 826884283
const DATA_SUBDIRS = ['', 'inventory', 'fishing', 'buffs']

export default class MigrateEconomy extends plugin {
  constructor() {
    super({
      name: '数据迁移',
      event: 'message',
      priority: 1000
    })
    
    this.initAutoMigrate()
  }

  manualMigrate = Command(/^#迁移数据$/, 'master', async (e) => {
      await this.runMigration(true)
      await e.reply("迁移检查完成，请查看日志。")
  })

  initAutoMigrate() {
    setTimeout(() => {
        this.checkBotStatus()
    }, 5000)
  }

  checkBotStatus() {
    if (global.bot && global.bot.self_id) {
        this.runMigration()
    } else {
        let attempts = 0
        const maxAttempts = 24 
        const interval = setInterval(() => {
            attempts++
            if (global.bot && global.bot.self_id) {
                clearInterval(interval)
                this.runMigration()
            } else if (attempts >= maxAttempts) {
                clearInterval(interval)
                logger.error('[Sakura] 迁移脚本等待 Bot 上线超时，停止自动迁移。')
            }
        }, 5000)
    }
  }

  async runMigration(isManual = false) {
    if (global.sakura_economy_migrated && !isManual) return
    global.sakura_economy_migrated = true

    logger.info(`[Sakura] 开始执行数据迁移: ${SOURCE_GROUP} -> ${TARGET_GROUP}`)

    let memberSet = new Set()
    try {
        const group = global.bot.pickGroup(TARGET_GROUP)
        if (!group) {
            logger.error(`[Sakura] 找不到目标群 ${TARGET_GROUP}，可能是 Bot 未加入该群或数据未同步。`)
            return
        }
        const memberList = await group.getMemberList(true)
        if (memberList && Array.isArray(memberList)) {
            memberList.forEach(m => memberSet.add(Number(m.user_id)))
        }
    } catch (err) {
        logger.error(`[Sakura] 无法获取目标群 ${TARGET_GROUP} 的成员列表，错误: ${err.message}`)
        return
    }

    if (memberSet.size === 0) {
        logger.error(`[Sakura] 目标群 ${TARGET_GROUP} 成员列表为空，跳过迁移。`)
        return
    }

    const economyBasePath = path.join(plugindata, 'economy')
    let totalMigrated = 0

    for (const subdir of DATA_SUBDIRS) {
        const dirPath = subdir ? path.join(economyBasePath, subdir) : economyBasePath
        const sourceFile = path.join(dirPath, `${SOURCE_GROUP}.json`)
        const targetFile = path.join(dirPath, `${TARGET_GROUP}.json`)

        if (!fs.existsSync(sourceFile)) continue

        let sourceData = {}
        try {
            sourceData = JSON.parse(fs.readFileSync(sourceFile, 'utf8'))
        } catch (e) {
            logger.error(`[Sakura] 读取源文件失败: ${sourceFile}`, e)
            continue
        }

        if (Object.keys(sourceData).length === 0) continue

        let targetData = {}
        if (fs.existsSync(targetFile)) {
            try {
                targetData = JSON.parse(fs.readFileSync(targetFile, 'utf8'))
            } catch (e) {
                logger.error(`[Sakura] 读取目标文件失败: ${targetFile}`, e)
            }
        }

        let changed = false
        let fileMigratedCount = 0

        for (const userId in sourceData) {
            if (memberSet.has(Number(userId))) {
                targetData[userId] = sourceData[userId]
                delete sourceData[userId]
                changed = true
                fileMigratedCount++
            }
        }

        if (changed) {
            try {
                fs.writeFileSync(sourceFile, JSON.stringify(sourceData, null, 2))
                const targetDir = path.dirname(targetFile)
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true })
                }
                fs.writeFileSync(targetFile, JSON.stringify(targetData, null, 2))
                
                logger.info(`[Sakura] ${subdir || 'economy'} 数据迁移: 已将 ${fileMigratedCount} 个用户的数据从 ${SOURCE_GROUP} 迁移至 ${TARGET_GROUP}`)
                totalMigrated += fileMigratedCount
            } catch (e) {
                logger.error(`[Sakura] 保存迁移数据失败: ${subdir || 'economy'}`, e)
            }
        }
    }

    logger.info(`[Sakura] 数据迁移完成，共迁移 ${totalMigrated} 条记录。`)
  }
}
