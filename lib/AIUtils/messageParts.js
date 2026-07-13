/**
 * 将内部消息 Part 转成指定模型协议所需的格式。
 */
export function processQueryParts(queryParts, channelType) {
  if (!queryParts || queryParts.length === 0) return queryParts;

  return queryParts.map((part) => {
    if (part.text) {
      return part;
    }
    if (part.inlineData) {
      if (channelType === "gemini") {
        return part;
      }

      const { mimeType, data } = part.inlineData;
      return {
        type: "image_url",
        image_url: {
          url: `data:${mimeType};base64,${data}`,
        },
      };
    }
    return part;
  });
}

export function buildOpenAIUserContent(parts = []) {
  const visibleParts = Array.isArray(parts)
    ? parts.filter((part) => part && part.thought !== true)
    : [];
  const processedParts = processQueryParts(visibleParts, "openai") || [];

  return processedParts
    .map((part) => {
      if (part.text && !part.type) {
        return { type: "text", text: part.text };
      }
      if (part.image_url && !part.type) {
        return { type: "image_url", image_url: part.image_url };
      }
      return part;
    })
    .filter((part) => part?.type === "text" || part?.type === "image_url");
}

export function buildMultimodalQueryParts(text, images = []) {
  return [
    { text: String(text || "") },
    ...(Array.isArray(images) ? images : [])
      .filter((image) => image?.base64 && image?.mimeType)
      .map((image) => ({
        inlineData: {
          mimeType: image.mimeType,
          data: image.base64,
        },
      })),
  ];
}
