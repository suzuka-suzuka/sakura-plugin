import { _path } from "./path.js";
import sharp from "sharp";

/**
 * 将图片 URL 转换为 base64 格式（自动将 GIF 转为 PNG）
 * @param {string} imageUrl - 图片 URL
 * @returns {Promise<object|null>} { base64, mimeType } 或 null
 */
export async function urlToBase64(imageUrl) {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      logger.warn(`下载图片失败: ${response.status}`);
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    let buffer = Buffer.from(arrayBuffer);
    let mimeType = response.headers.get("content-type") || "image/jpeg";

    if (mimeType === "image/gif") {
      buffer = await sharp(buffer).toFormat("png").toBuffer();
      mimeType = "image/png";
    }

    const base64 = buffer.toString("base64");
    return { base64, mimeType };
  } catch (error) {
    logger.error(`转换图片为 base64 失败: ${error.message}`);
    return null;
  }
}

/**
 * 获取消息中的图片
 * @param {object} e - 消息事件对象
 * @param {boolean} getAvatar - 是否获取头像
 * @param {boolean} toBase64 - 是否转换为 base64
 * @returns {Promise<Array|null>} 图片 URL 数组 或 base64 对象数组
 */
export async function getImg(e, getAvatar = false, toBase64 = false) {
  if (!e.message || !Array.isArray(e.message)) {
    return null;
  }

  let imageUrls = [];

  const directImageUrls = e.message
    .filter((segment) => segment.type === "image" && segment.data?.url)
    .map((segment) => segment.data.url);

  if (directImageUrls.length > 0) {
    imageUrls = directImageUrls;
  } else if (e.reply_id) {
    const sourceMessageData = await e.getReplyMsg();
    const messageSegments = sourceMessageData?.message;

    if (messageSegments && Array.isArray(messageSegments)) {
      const repliedImageUrls = messageSegments
        .filter((segment) => segment.type === "image" && segment.data?.url)
        .map((segment) => segment.data.url);

      if (repliedImageUrls.length > 0) {
        imageUrls = repliedImageUrls;
      }
    }
  }

  if (imageUrls.length === 0 && getAvatar) {
    const atMsg = e.at;
    if (atMsg) {
      imageUrls = [`https://q1.qlogo.cn/g?b=qq&s=640&nk=${atMsg}`];
    }
  }

  if (imageUrls.length === 0) {
    return null;
  }

  e.img = imageUrls;

  if (toBase64) {
    const base64Results = await Promise.all(
      imageUrls.map((url) => urlToBase64(url))
    );
    return base64Results.filter(Boolean);
  }

  return imageUrls;
}

export async function randomReact(e) {
  const emojiList = [
    { id: "424", name: "续标识" },
    { id: "66", name: "爱心" },
    { id: "318", name: "崇拜" },
    { id: "10024", name: "闪光" },
    { id: "319", name: "比心" },
    { id: "269", name: "暗中观察" },
    { id: "38", name: "敲打" },
    { id: "181", name: "戳一戳" },
    { id: "351", name: "敲打" },
    { id: "350", name: "贴贴" },
    { id: "21", name: "可爱" },
    { id: "34", name: "晕" },
    { id: "270", name: "emm" },
    { id: "352", name: "咦" },
    { id: "49", name: "拥抱" },
    { id: "128513", name: "😁 呲牙" },
    { id: "128514", name: "😂 激动" },
    { id: "128516", name: "😄 高兴" },
    { id: "128522", name: "😊 嘿嘿" },
    { id: "128524", name: "😌 羞涩" },
    { id: "128527", name: "😏 哼哼" },
    { id: "128530", name: "😒 不屑" },
    { id: "128531", name: "😓 汗" },
    { id: "128532", name: "😔 失落" },
    { id: "128536", name: "😘 飞吻" },
    { id: "128538", name: "😚 亲亲" },
    { id: "128540", name: "😜 淘气" },
    { id: "128541", name: "😝 吐舌" },
    { id: "128557", name: "😭 大哭" },
    { id: "128560", name: "😰 紧张" },
    { id: "128563", name: "😳 瞪眼" },
  ];

  const randomEmoji = emojiList[Math.floor(Math.random() * emojiList.length)];
  const emojiId = randomEmoji.id;

  await e.react(emojiId);
}

/**
 * 判断文本是否包含 Markdown 语法
 * @param {string} text
 * @returns {boolean}
 */
export function isMdText(text) {
  const mdRegex = /(```|\|.*\||#{1,6}\s|(\*\*|__)(.*?)\2|`[^`]+`|^\s*[-*+]\s|^\s*\d+\.\s|!\[.*?\]\(.*?\)|\[.*?\]\(.*?\)|>)/m;
  return mdRegex.test(text);
}

/**
 * 通过三层合并转发发送 Markdown 消息
 * （经测试：第二层 markdown 会失败，必须放在第三层才能成功）
 *
 * @param {object} e - 消息事件对象
 * @param {string} markdownContent - Markdown 文本内容
 * @param {object} [opts] - 可选项
 * @param {string} [opts.source]  - 转发卡片来源标注，默认 "消息"
 * @param {string} [opts.prompt]  - 转发卡片预览文字，默认 "点击查看详情"
 * @param {string} [opts.outerNickname] - 外层节点显示名，默认触发用户昵称
 * @param {string} [opts.innerNickname] - 内层节点显示名，同上
 * @returns {Promise<object|null>} sendForwardMsg 的返回值
 */
export async function sendMarkdownMsg(e, markdownContent, opts = {}) {
  const userId = e.self_id;
  const defaultNickname = bot.nickname || String(e.self_id);

  const {
    source = "Markdown消息",
    prompt = "点击查看详情",
    outerNickname = defaultNickname,
    innerNickname = defaultNickname,
  } = opts;

  // 第三层：真正的 markdown 节点
  const layer3_node = {
    type: "node",
    data: {
      user_id: userId,
      nickname: innerNickname,
      content: [
        { type: "markdown", data: { content: markdownContent } },
      ],
    },
  };

  // 第二层（包裹第三层）→ 第一层节点的 content
  const layer1_nodes = [
    {
      user_id: userId,
      nickname: outerNickname,
      content: [layer3_node],
    },
  ];

  try {
    const result = await e.sendForwardMsg(layer1_nodes, { source, prompt });
    if (!result || !result.message_id) {
      logger.warn("[sendMarkdownMsg] 发送可能失败，result:", result);
    }
    return result;
  } catch (err) {
    logger.error(`[sendMarkdownMsg] 发送失败: ${err.message}`);
    return null;
  }
}
