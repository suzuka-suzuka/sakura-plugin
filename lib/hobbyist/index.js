import fetch from "node-fetch";


class Hobbyist {
  async getVersion() {
    let rep = await fetch("https://gsv2p.acgnai.top/version");
    let { support_versions } = await rep.json();
    return support_versions;
  }

  async getCategories() {
    let rep = await fetch("https://rs.acgnai.top/api/model_libry/categories", {
      method: "POST",
      body: JSON.stringify({
        link: "line1",
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });
    return await rep.json();
  }

  async getModelList(version = "v4") {
    let rep = await fetch("https://gsv2p.acgnai.top/models/" + version);
    let { models } = await rep.json();
    return models;
  }

  // 查找匹配的角色模型名
  async findModel(model_name) {
    let models = await this.getModelList();
    if (model_name == "爱丽丝") model_name = "爱丽丝（女仆）";
    let modelKey = Object.keys(models).find(
      (item) =>
        item.endsWith(`中文-${model_name}`) ||
        item.endsWith(`中文-${model_name}_ZH`)
    );
    return modelKey || null;
  }

  // 获取角色支持的情绪列表
  async getModelEmotions(model_name) {
    let models = await this.getModelList();
    let modelKey = await this.findModel(model_name);
    if (!modelKey) return null;
    // 返回中文情绪列表
    return models[modelKey]["中文"] || ["默认"];
  }

  // 使用匹配角色名进行语音合成
  async getModelDetail(model_name, text, emotion = "默认") {
    let model = await this.findModel(model_name);
    if (!model) return null;
    return await this.getModelAudio(model, text, emotion);
  }

  // 使用精确角色模型名进行语音合成
  async getModelAudio(model_name, text, emotion = "默认") {
    let rep = await fetch("https://gsv2p.acgnai.top/infer_single", {
      method: "POST",
      body: JSON.stringify({
        batch_size: 10,
        batch_threshold: 0.75,
        emotion: emotion,
        fragment_interval: 0.3,
        if_sr: false,
        media_type: "wav",
        model_name,
        parallel_infer: true,
        prompt_text_lang: "中文",
        repetition_penalty: 1.35,
        sample_steps: 16,
        seed: -1,
        speed_facter: 1,
        split_bucket: true,
        temperature: 1,
        text: text,
        text_lang: "中文",
        text_split_method: "按中文句号。切",
        top_k: 10,
        top_p: 1,
        version: "v4",
      }),
      headers: {
        "Content-Type": "application/json",
        referer: "https://tts.acgnai.top/",
        origin: "https://tts.acgnai.top",
        authorization: "Bearer guest",
      },
    });

    let res = await rep.json();
    return res;
  }
}

export default new Hobbyist();
