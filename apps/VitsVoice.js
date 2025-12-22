import axios from "axios";
import setting from "../lib/setting.js";

const API_URL = "https://mikusfan-vits-uma-genshin-honkai.hf.space/api/predict";
let speakersCache = [];

export class VitsVoice extends plugin {
  constructor() {
    super({
      name: "VitsVoice",
      dsc: "VITS语音合成插件",
      event: "message",
      priority: 1135,
    });
  }

  vitsSpeak = Command(/^#?(.+)?说\s+(.*)$/, async (e) => {
    let msg = e.msg.replace(/^#/, "");
    let config = setting.getConfig("VitsVoice");
    let speaker = config.defaultSpeaker || "派蒙";
    let text = "";

    if (msg.startsWith("说")) {
      text = msg.substring(1).trim();
    } else {
      const match = msg.match(/^(.+?)说\s+(.*)$/);
      if (match) {
        speaker = match[1].trim();
        text = match[2].trim();
      } else {
        return false;
      }
    }

    if (!text) return false;
    await e.react(124) ;
    let lang = "中文";
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) {
      lang = "日语";
    } else if (/^[a-zA-Z\s,.?!]+$/.test(text)) {
      lang = "English";
    }

    let noise_scale = 0.6;
    let noise_scale_w = 0.668;
    let length_scale = 1.2;

    try {
      const payload = {
        fn_index: 0,
        data: [text, lang, speaker, noise_scale, noise_scale_w, length_scale],
        session_hash: Math.random().toString(36).substring(2),
      };

      const response = await axios.post(API_URL, payload);
      const data = response.data;

      if (data.data && data.data[1]) {
        const audioData = data.data[1];

        if (audioData.data) {
          const base64 = audioData.data.split(",")[1];
          const buffer = Buffer.from(base64, "base64");
          await e.reply(segment.record(buffer));
        } else if (audioData.name) {
          const audioUrl = `https://mikusfan-vits-uma-genshin-honkai.hf.space/file=${audioData.name}`;
          await e.reply(segment.record(audioUrl));
        } else {
          await e.reply("API 返回数据格式异常，无法获取音频。",10,true);
          logger.warn(
            `[VitsVoice] API Response Error: ${JSON.stringify(data)}`
          );
        }
      } else {
        await e.reply(
          "生成失败，API 未返回有效数据。可能是角色名不正确或服务繁忙。",10,true
        );
        logger.warn(`[VitsVoice] API Error Response: ${JSON.stringify(data)}`);
      }
    } catch (err) {
      let errMsg = err.message;
      if (err.response) {
        errMsg += ` [Status: ${err.response.status}]`;
        if (err.response.data) {
          errMsg += ` [Data: ${JSON.stringify(err.response.data).substring(
            0,
            100
          )}...]`;
        }
      }
      logger.error(`[VitsVoice] 语音生成出错: ${errMsg}`);
      await e.reply("语音生成出错，请稍后再试。");
    }
  });

  searchSpeaker = Command(/^#?搜索语音角色(.*)$/, async (e) => {
    let keyword = e.msg.replace(/^#?搜索语音角色\s*/, "").trim();
    if (!keyword) {
      return false;
    }
    await e.react(124) ;
    try {
      const payload = {
        fn_index: 2,
        data: [keyword],
        session_hash: Math.random().toString(36).substring(2),
      };

      const response = await axios.post(API_URL, payload);
      const data = response.data;

      if (data.data && data.data[0]) {
        const result = data.data[0];
        if (typeof result === "string") {
          await e.reply(`找到角色：${result}`);
        } else if (Array.isArray(result)) {
          await e.reply(`找到角色：${result.join(", ")}`);
        } else if (result && result.choices) {
          await e.reply(`找到角色：${result.choices.join(", ")}`);
        } else {
          await e.reply(`搜索结果：${JSON.stringify(result)}`);
        }
      } else {
        await e.reply("未找到相关角色。", 10);
      }
    } catch (err) {
      let errMsg = err.message;
      if (err.response) {
        errMsg += ` [Status: ${err.response.status}]`;
      }
      logger.error(`[VitsVoice] 搜索出错: ${errMsg}`);
      await e.reply("搜索出错，请稍后再试。", 10,true);
    }
  });

  getSpeakersList = Command(/^#?语音角色列表\s*(\d*)$/, async (e) => {
    await e.react(124) ;
    if (!speakersCache || speakersCache.length === 0) {
      try {
        const response = await axios.get(
          "https://mikusfan-vits-uma-genshin-honkai.hf.space/config"
        );
        const component = response.data.components.find((c) => c.id === 13);
        if (component && component.props && component.props.choices) {
          speakersCache = component.props.choices;
        }
      } catch (err) {
        logger.error("[VitsVoice] 获取角色列表失败", err);
        return e.reply("获取角色列表失败，请稍后再试。", 10);
      }
    }

    if (!speakersCache || speakersCache.length === 0) {
      return e.reply("未获取到角色列表。", 10,true);
    }

    let nodes = [];
    for (let i = 0; i < speakersCache.length; i += 50) {
      const chunk = speakersCache.slice(i, i + 50);
      nodes.push({
        type: "node",
        data: {
          user_id: bot.self_id,
          nickname: bot.nickname,
          content: chunk.join("，"),
        },
      });
    }

    await e.sendForwardMsg(nodes, { source: `语音角色列表（共${speakersCache.length}个）` });
  });

  changeDefaultSpeaker = Command(/^#?切换语音(.*)$/, async (e) => {
    let newSpeaker = e.msg.replace(/^#?切换语音\s*/, "").trim();
    if (!newSpeaker) {
      return false;
    }

    setting.setConfig("VitsVoice", { defaultSpeaker: newSpeaker });
    await e.reply(`默认语音角色已切换为：${newSpeaker}`, 10);
  });
}
