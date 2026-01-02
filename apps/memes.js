import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import _ from "lodash";
import { plugindata } from "../lib/path.js";
import { getImg } from "../lib/utils.js";
import EconomyManager from "../lib/economy/EconomyManager.js";

const baseUrl = "https://memes.ikechan8370.com";

const dataDir = path.join(plugindata, "memes");
const infosPath = path.join(dataDir, "infos.json");
const keyMapPath = path.join(dataDir, "keyMap.json");
const listImagePath = path.join(dataDir, "render_list1.jpg");

let keyMap = {};
let infos = {};

const maxFileSizeByte = 10 * 1024 * 1024;

function mkdirs(dirname) {
  if (fs.existsSync(dirname)) {
    return true;
  }
  if (mkdirs(path.dirname(dirname))) {
    fs.mkdirSync(dirname);
    return true;
  }
}

function checkFileSize(files) {
  let fileList = Array.isArray(files) ? files : [files];
  fileList = fileList.filter((file) => !!file?.size);
  if (fileList.length === 0) {
    return false;
  }
  return fileList.some((file) => file.size >= maxFileSizeByte);
}

async function getAvatar(e, userId = e.user_id) {
  return `https://q1.qlogo.cn/g?b=qq&s=0&nk=${userId}`;
}

function detail(code) {
  const d = infos[code];
  if (!d) return "未找到该表情信息";

  let keywords = d.keywords.join("、");
  let ins = `【代码】${d.key}\n【名称】${keywords}\n【最大图片数量】${
    d.params.max_images
  }\n【最小图片数量】${d.params.min_images}\n【最大文本数量】${
    d.params.max_texts
  }\n【最小文本数量】${
    d.params.min_texts
  }\n【默认文本】${d.params.default_texts.join("/")}\n`;

  if (d.params.args_type?.parser_options?.length > 0) {
    let supportArgs = generateSupportArgsText(d);
    ins += `【支持参数】${supportArgs}`;
  }

  return ins;
}

function generateSupportArgsText(info) {
  try {
    const argsType = info.params.args_type;
    const props = argsType.args_model.properties;
    const options = argsType.parser_options;

    let mainParam = "";
    let description = "";

    for (const prop in props) {
      if (prop !== "user_infos") {
        const propInfo = props[prop];
        mainParam = prop;

        const option = options.find(
          (opt) =>
            opt.dest === prop ||
            (opt.args && opt.args.some((arg) => arg.name === prop))
        );

        if (option?.help_text) {
          description = option.help_text;
        } else if (propInfo.description) {
          description = propInfo.description;
        }

        if (propInfo.enum) {
          const chineseNames = options
            .filter(
              (opt) =>
                opt.action?.type === 0 && opt.action?.value && opt.dest === prop
            )
            .flatMap((opt) => opt.names.filter((name) => !/^-/.test(name)));

          const englishNames = options
            .filter(
              (opt) =>
                opt.action?.type === 0 && opt.action?.value && opt.dest === prop
            )
            .flatMap((opt) =>
              opt.names
                .filter((name) => name.startsWith("--"))
                .map((name) => name.substring(2))
            );

          const valueNames = [...new Set([...chineseNames, ...englishNames])];

          if (valueNames.length > 0) {
            const valuesText = valueNames.join("、");
            const exampleName =
              chineseNames.length > 0 ? chineseNames[0] : valueNames[0];
            return `${
              description || prop
            }，可选值：${valuesText}。如#${exampleName}`;
          }
        } else if (propInfo.type === "integer" || propInfo.type === "number") {
          let rangeText = "";
          if (
            propInfo.minimum !== undefined &&
            propInfo.maximum !== undefined
          ) {
            rangeText = `范围为${propInfo.minimum}~${propInfo.maximum}`;
          } else if (
            propInfo.description &&
            propInfo.description.includes("范围")
          ) {
            rangeText = propInfo.description;
          }

          return `${description || prop}${
            rangeText ? "，" + rangeText : ""
          }。如#1`;
        }

        break;
      }
    }

    return description || `${mainParam}参数`;
  } catch (e) {
    logger.error(`生成参数说明出错: ${e.message}`);
    return "支持额外参数";
  }
}

function handleArgs(key, args) {
  if (!args) {
    args = "";
  }

  let argsObj = {};

  if (infos[key]?.params?.args_type) {
    const argsType = infos[key].params.args_type;
    const argsModel = argsType.args_model;
    const parserOptions = argsType.parser_options || [];

    for (const prop in argsModel.properties) {
      if (prop === "user_infos") continue;

      const propInfo = argsModel.properties[prop];

      const relatedOptions = parserOptions.filter(
        (opt) =>
          opt.dest === prop ||
          (opt.args && opt.args.some((arg) => arg.name === prop))
      );

      if (propInfo.enum && relatedOptions.length > 0) {
        const valueMap = {};

        relatedOptions.forEach((opt) => {
          if (opt.action?.type === 0) {
            opt.names.forEach((name) => {
              if (!/^-/.test(name)) {
                valueMap[name] = opt.action.value;
              } else if (name.startsWith("--")) {
                const simpleName = name.substring(2);
                valueMap[simpleName] = opt.action.value;
              }
            });
          }
        });

        const trimmedArg = args.trim();
        argsObj[prop] = valueMap[trimmedArg] || propInfo.default;
      } else if (propInfo.type === "integer" || propInfo.type === "number") {
        const trimmedArg = args.trim();
        if (/^\d+$/.test(trimmedArg)) {
          const numValue = parseInt(trimmedArg);
          argsObj[prop] = numValue;
        }
      }
    }
  }

  return JSON.stringify(argsObj);
}

function findLongestMatchingKey(msg, keyMap) {
  const matchingKeys = Object.keys(keyMap).filter((k) => msg.startsWith(k));
  if (matchingKeys.length === 0) {
    return null;
  }
  return matchingKeys.sort((a, b) => b.length - a.length)[0];
}

export class memesPlugin extends plugin {
  constructor() {
    super({
      name: "表情包制作",
      event: "message",
      priority: 1135,
      log: false,
    });
  }

  async init() {
    mkdirs(dataDir);
    keyMap = {};
    infos = {};

    if (fs.existsSync(infosPath)) {
      try {
        infos = JSON.parse(fs.readFileSync(infosPath, "utf-8"));
      } catch (e) {
        logger.error(`读取 infos.json 失败: ${e.message}`);
      }
    }

    if (fs.existsSync(keyMapPath)) {
      try {
        keyMap = JSON.parse(fs.readFileSync(keyMapPath, "utf-8"));
      } catch (e) {
        logger.error(`读取 keyMap.json 失败: ${e.message}`);
      }
    }

    if (Object.keys(infos).length === 0) {
      try {
        const infosRes = await fetch(`${baseUrl}/memes/static/infos.json`);
        if (infosRes.status === 200) {
          infos = await infosRes.json();
          fs.writeFileSync(infosPath, JSON.stringify(infos));
        }
      } catch (e) {
        logger.error(`拉取 infos.json 失败: ${e.message}`);
      }
    }

    if (Object.keys(keyMap).length === 0) {
      try {
        const keyMapRes = await fetch(`${baseUrl}/memes/static/keyMap.json`);
        if (keyMapRes.status === 200) {
          keyMap = await keyMapRes.json();
          fs.writeFileSync(keyMapPath, JSON.stringify(keyMap));
        }
      } catch (e) {
        logger.error(`拉取 keyMap.json 失败: ${e.message}`);
      }
    }

    if (Object.keys(infos).length === 0 || Object.keys(keyMap).length === 0) {
      try {
        const infoRes = await fetch(`${baseUrl}/meme/infos`);
        const info = await infoRes.json();

        const keyMapTmp = {};
        const infosTmp = {};
        for (const memeInfo of info) {
          const key = memeInfo.key;
          memeInfo?.keywords.forEach((keyword) => {
            keyMapTmp[keyword] = key;
          });
          infosTmp[key] = memeInfo;
        }
        infos = infosTmp;
        keyMap = keyMapTmp;
        fs.writeFileSync(keyMapPath, JSON.stringify(keyMap));
        fs.writeFileSync(infosPath, JSON.stringify(infos));
      } catch (e) {
        logger.error(`从API生成数据失败: ${e.message}`);
      }
    }
  }

  autoUpdate = Cron("0 3 * * *", async () => {
    await this.init();
  });

  memesList = Command(/^#?(meme(s)?|表情包)列表$/, async (e) => {
    try {
      if (fs.existsSync(listImagePath)) {
        await e.reply(segment.image(listImagePath));
        return true;
      }

      const response = await fetch(baseUrl + "/tools/render_list", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sort_by: "date_created",
        }),
      });

      const imageId = (await response.json()).image_id;
      const imageResponse = await fetch(baseUrl + "/image/" + imageId);
      const resultBlob = await imageResponse.blob();
      const resultArrayBuffer = await resultBlob.arrayBuffer();
      const resultBuffer = Buffer.from(resultArrayBuffer);
      fs.writeFileSync(listImagePath, resultBuffer);
      await e.reply(segment.image(listImagePath));

      setTimeout(() => {
        if (fs.existsSync(listImagePath)) {
          fs.unlinkSync(listImagePath);
        }
      }, 3600000);
    } catch (err) {
      logger.error(err);
      await e.reply("获取表情包列表失败：" + err.message);
    }
    return true;
  });

  randomMemes = Command(/^#?随机(meme(s)?|表情包)/, async (e) => {
    const keys = Object.keys(infos).filter(
      (key) =>
        infos[key].params.min_images === 1 && infos[key].params.min_texts === 0
    );

    if (keys.length === 0) {
      return e.reply("暂无可用的表情包", 10);
    }

    const index = _.random(0, keys.length - 1, false);
    e.msg = infos[keys[index]].keywords[0];
    return await this.makeMeme(e);
  });

  memesHelp = Command(/^#?(meme(s)?|表情包)帮助/, async (e) => {
    await e.reply(
      "【memes列表】：查看支持的memes列表\n【{表情名称}】：memes列表中的表情名称，根据提供的文字或图片制作表情包\n【随机meme】：随机制作一些表情包\n【meme搜索+关键词】：搜索表情包关键词\n【{表情名称}+详情】：查看该表情所支持的参数"
    );
    return true;
  });

  memesSearch = Command(/^#?(meme(s)?|表情包)搜索/, async (e) => {
    const search = e.msg.replace(/^#?(meme(s)?|表情包)搜索/, "").trim();
    if (!search) {
      await e.reply("你要搜什么？");
      return true;
    }
    const hits = Object.keys(keyMap).filter((k) => k.indexOf(search) > -1);
    let result = "搜索结果";
    if (hits.length > 0) {
      for (let i = 0; i < hits.length; i++) {
        result += `\n${i + 1}. ${hits[i]}`;
      }
    } else {
      result += "\n无";
    }
    await e.reply(result);
    return true;
  });

  memesUpdate = Command(/^#?(meme(s)?|表情包)更新/, "master", async (e) => {
    await e.reply("表情包资源更新中...");
    if (fs.existsSync(infosPath)) {
      fs.unlinkSync(infosPath);
    }
    if (fs.existsSync(keyMapPath)) {
      fs.unlinkSync(keyMapPath);
    }
    if (fs.existsSync(listImagePath)) {
      fs.unlinkSync(listImagePath);
    }
    try {
      await this.init();
    } catch (err) {
      logger.error(err);
      await e.reply("更新失败：" + err.message, 10);
      return true;
    }
    await e.reply("更新完成", 10);
    return true;
  });

  memes = Command(/^#.+/, 9999, async (e) => {
    const msg = e.msg.substring(1);

    const target = findLongestMatchingKey(msg, keyMap);
    if (!target) {
      return false;
    }

    return await this.makeMeme(e);
  });

  async makeMeme(e) {
    const msg = e.msg.substring(1);
    const target = findLongestMatchingKey(msg, keyMap);
    if (!target) {
      return false;
    }

    const targetCode = keyMap[target];
    let text1 = msg.replace(target, "");

    if (text1.trim() === "详情" || text1.trim() === "帮助") {
      await e.reply(detail(targetCode));
      return true;
    }

    const economyManager = new EconomyManager(e);
    if (!e.isMaster && !economyManager.pay(e, 5)) {
      return false;
    }
    await e.react(124);
    let [text, args = ""] = text1.split("#");
    const info = infos[targetCode];

    if (!info) {
      return false;
    }

    let imageIds = [];
    let texts = [];

    if (info.params.max_images > 0) {
      let imgUrls = [];

      const imgs = await getImg(e, true, false);
      if (imgs && imgs.length > 0) {
        imgUrls = imgs;
      }

      if (!imgUrls || imgUrls.length === 0) {
        imgUrls = [await getAvatar(e)];
      }

      if (
        imgUrls.length < info.params.min_images &&
        imgUrls.indexOf(await getAvatar(e)) === -1
      ) {
        const me = [await getAvatar(e)];
        imgUrls = me.concat(imgUrls);
      }

      imgUrls = imgUrls.slice(
        0,
        Math.min(info.params.max_images, imgUrls.length)
      );

      for (let i = 0; i < imgUrls.length; i++) {
        const imgUrl = imgUrls[i];
        try {
          const imageResponse = await fetch(imgUrl);
          const blob = await imageResponse.blob();
          const arrayBuffer = await blob.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const base64Data = buffer.toString("base64");

          if (checkFileSize([{ size: buffer.length }])) {
            return e.reply("文件大小超出限制，最多支持10MB", 10);
          }

          const uploadResponse = await fetch(`${baseUrl}/image/upload`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              type: "data",
              data: base64Data,
            }),
          });

          if (uploadResponse.status > 299) {
            const error = await uploadResponse.text();
            logger.error("图片上传失败:", error);
            await e.reply("图片上传失败：" + error, 10);
            return true;
          }

          const uploadResult = await uploadResponse.json();
          imageIds.push({
            name: `image_${i}`,
            id: uploadResult.image_id,
          });
        } catch (err) {
          logger.error(`处理图片失败: ${err.message}`);
          await e.reply("处理图片时出错：" + err.message);
          return true;
        }
      }
    }

    if (text && info.params.max_texts === 0) {
      return false;
    }

    if (!text && info.params.min_texts > 0) {
      const atMsg = e.at;
      if (atMsg) {
        try {
          const memberInfo = await e.getInfo(atMsg);
          text = memberInfo?.card || memberInfo?.nickname || String(atMsg);
        } catch {
          text = String(atMsg);
        }
      } else {
        text = e.sender?.card || e.sender?.nickname || "";
      }
    }

    let textList = text ? text.split("/", info.params.max_texts) : [];
    if (textList.length < info.params.min_texts) {
      await e.reply(`字不够！要至少${info.params.min_texts}个用/隔开！`, 10);
      return true;
    }
    texts = textList;

    if (info.params.max_texts > 0 && texts.length === 0) {
      if (texts.length < info.params.max_texts) {
        const atMsg = e.at;
        if (atMsg) {
          try {
            const memberInfo = await e.getInfo(atMsg);
            texts.push(
              memberInfo?.card || memberInfo?.nickname || String(atMsg)
            );
          } catch {
            texts.push(String(atMsg));
          }
        } else {
          texts.push(e.sender?.card || e.sender?.nickname || "");
        }
      }
    }

    let options = {};
    args = handleArgs(targetCode, args);
    if (args) {
      try {
        options = JSON.parse(args);
      } catch {
        options = {};
      }
    }

    logger.debug("meme input:", {
      target,
      targetCode,
      images: imageIds,
      texts,
      options,
    });

    try {
      const response = await fetch(`${baseUrl}/memes/${targetCode}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          images: imageIds,
          texts,
          options,
        }),
      });

      if (response.status > 299) {
        const error = await response.text();
        logger.error(error);
        await e.reply(error, 10);
        return true;
      }

      const result = await response.json();
      const resultImageId = result.image_id;

      const imageResponse = await fetch(`${baseUrl}/image/${resultImageId}`);
      const resultBlob = await imageResponse.blob();
      const resultArrayBuffer = await resultBlob.arrayBuffer();
      const resultBase64 = Buffer.from(resultArrayBuffer).toString("base64");

      await e.reply(segment.image(`base64://${resultBase64}`));
    } catch (err) {
      logger.error(`制作表情包失败: ${err.message}`);
      await e.reply("制作表情包失败：" + err.message, 10);
    }

    return true;
  }
}
