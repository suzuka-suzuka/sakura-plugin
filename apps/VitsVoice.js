import setting from "../lib/setting.js";
import hobbyist from "../lib/hobbyist/index.js";

let speakersCache = [];

export class VitsVoice extends plugin {
  constructor() {
    super({
      name: "VitsVoice",
      dsc: "VITS语音合成插件 (GPT-SoVITS)",
      event: "message",
      priority: 1135,
    });
  }

  vitsSpeak = Command(/^#?(.+)?说\s+(.*)$/, async (e) => {
    let msg = e.msg.replace(/^#/, "");
    let config = setting.getConfig("VitsVoice");
    let speaker = config.defaultSpeaker || "派蒙";
    let emotion = config.defaultEmotion || "默认";
    let text = "";

    if (msg.startsWith("说")) {
      text = msg.substring(1).trim();
    } else {
      // 支持格式: 可莉说 / 可莉(开心)说
      const match = msg.match(/^(.+?)(?:\((.+?)\))?说\s+(.*)$/);
      if (match) {
        speaker = match[1].trim();
        if (match[2]) {
          emotion = match[2].trim();
        }
        text = match[3].trim();
      } else {
        return false;
      }
    }

    if (!text) return false;
    await e.react(124);

    try {
      logger.info(`[VitsVoice] 合成语音: 角色=${speaker}, 情绪=${emotion}, 文本=${text}`);
      const result = await hobbyist.getModelDetail(speaker, text, emotion);

      if (!result) {
        await e.reply(`未找到角色「${speaker}」，请使用 #语音角色列表 查看可用角色。`, 10, true);
        return;
      }

      if (result.audio) {
        const buffer = Buffer.from(result.audio, "base64");
        await e.reply(segment.record(buffer));
      } else if (result.audio_url) {
        await e.reply(segment.record(result.audio_url));
      } else if (result.error) {
        await e.reply(`语音合成失败: ${result.error}`, 10, true);
        logger.warn(`[VitsVoice] API Error: ${JSON.stringify(result)}`);
      } else {
        await e.reply("API 返回数据格式异常，无法获取音频。", 10, true);
        logger.warn(`[VitsVoice] API Response Error: ${JSON.stringify(result)}`);
      }
    } catch (err) {
      logger.error(`[VitsVoice] 语音生成出错: ${err.message}`);
      await e.reply("语音生成出错，请稍后再试。");
    }
  });

  searchSpeaker = Command(/^#?搜索语音角色(.*)$/, async (e) => {
    let keyword = e.msg.replace(/^#?搜索语音角色\s*/, "").trim();
    if (!keyword) {
      return false;
    }
    await e.react(124);
    
    try {
      const models = await hobbyist.getModelList();
      const modelNames = Object.keys(models);
      
      const matches = modelNames.filter((name) => name.includes(keyword));
      
      if (matches.length > 0) {
        const speakers = matches.map((m) => {
          const parts = m.split("-");
          return parts[parts.length - 1];
        });
        const uniqueSpeakers = [...new Set(speakers)].slice(0, 20);
        await e.reply(`找到角色：${uniqueSpeakers.join("、")}`);
      } else {
        await e.reply("未找到相关角色。", 10);
      }
    } catch (err) {
      logger.error(`[VitsVoice] 搜索出错: ${err.message}`);
      await e.reply("搜索出错，请稍后再试。", 10, true);
    }
  });

  getSpeakersList = Command(/^#?语音角色列表\s*(\d*)$/, async (e) => {
    await e.react(124);
    
    try {
      if (!speakersCache || speakersCache.length === 0) {
        const models = await hobbyist.getModelList();
        const modelNames = Object.keys(models);
        
        speakersCache = modelNames
          .filter((name) => name.includes("中文-"))
          .map((name) => {
            const parts = name.split("-");
            return parts[parts.length - 1].replace(/_ZH$/, "");
          });
        speakersCache = [...new Set(speakersCache)].sort();
      }

      if (!speakersCache || speakersCache.length === 0) {
        return e.reply("未获取到角色列表。", 10, true);
      }

      let nodes = [];
      for (let i = 0; i < speakersCache.length; i += 50) {
        const chunk = speakersCache.slice(i, i + 50);
        nodes.push({
          user_id: e.bot.self_id,
          nickname: e.bot.nickname,
          content: chunk.join("、"),
        });
      }

      await e.sendForwardMsg(nodes, {
        source: `语音角色列表（共${speakersCache.length}个）`,
        prompt: "快来选一个喜欢的角色吧！",
      });
    } catch (err) {
      logger.error("[VitsVoice] 获取角色列表失败", err);
      return e.reply("获取角色列表失败，请稍后再试。", 10);
    }
  });

  changeDefaultSpeaker = Command(/^#?切换语音(.*)$/, async (e) => {
    let input = e.msg.replace(/^#?切换语音\s*/, "").trim();
    if (!input) {
      return false;
    }

    // 支持格式: 切换语音 可莉 / 切换语音 可莉 开心
    const parts = input.split(/\s+/);
    const newSpeaker = parts[0];
    const newEmotion = parts[1] || null;

    await e.react(124);

    // 验证角色是否存在
    try {
      const model = await hobbyist.findModel(newSpeaker);
      if (!model) {
        await e.reply(`未找到角色「${newSpeaker}」，请使用 #语音角色列表 查看可用角色。`, 10, true);
        return;
      }

      // 如果指定了情绪，验证情绪是否支持
      if (newEmotion) {
        const emotions = await hobbyist.getModelEmotions(newSpeaker);
        if (emotions && !emotions.includes(newEmotion)) {
          await e.reply(`角色「${newSpeaker}」不支持情绪「${newEmotion}」\n支持的情绪：${emotions.join("、")}`, 10, true);
          return;
        }
      }

      const configUpdate = { defaultSpeaker: newSpeaker };
      if (newEmotion) {
        configUpdate.defaultEmotion = newEmotion;
      }

      setting.setConfig("VitsVoice", configUpdate);
      
      let replyMsg = `默认语音角色已切换为：${newSpeaker}`;
      if (newEmotion) {
        replyMsg += `，默认情绪：${newEmotion}`;
      }
      await e.reply(replyMsg, 10);
    } catch (err) {
      logger.error(`[VitsVoice] 切换语音出错: ${err.message}`);
      await e.reply("切换语音出错，请稍后再试。", 10, true);
    }
  });

  // 查看角色支持的情绪
  getEmotions = Command(/^#?查看角色情绪\s*(.*)$/, async (e) => {
    let speaker = e.msg.replace(/^#?查看角色情绪\s*/, "").trim();
    if (!speaker) {
      const config = setting.getConfig("VitsVoice");
      speaker = config.defaultSpeaker || "派蒙";
    }
    
    await e.react(124);
    
    try {
      const emotions = await hobbyist.getModelEmotions(speaker);
      if (!emotions) {
        await e.reply(`未找到角色「${speaker}」`, 10, true);
        return;
      }
      await e.reply(`角色「${speaker}」支持的情绪：\n${emotions.join("、")}`, 10);
    } catch (err) {
      logger.error(`[VitsVoice] 获取情绪列表出错: ${err.message}`);
      await e.reply("获取情绪列表出错，请稍后再试。", 10, true);
    }
  });
}
