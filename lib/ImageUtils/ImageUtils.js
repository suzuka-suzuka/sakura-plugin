import axios from "axios"
import _ from "lodash"
import sharp from "sharp"

export async function downloadImage(imageUrl) {
  if (!imageUrl) {
    logger.warn(`未提供图片 URL.`)
    return false
  }
  logger.info(`下载图片: ${imageUrl}`)

  try {
    const imageResponse = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 60000,
    })

    return Buffer.from(imageResponse.data)
  } catch (error) {
    logger.error(
      `下载图片时出错: ${error.message}, 状态码: ${error.response ? error.response.status : "未知"}`,
    )
    return false
  }
}

export async function yandeimage(apiUrl) {
  if (!apiUrl || typeof apiUrl !== "string") {
    logger.error(`未提供有效的 API URL.`)
    return false
  }

  try {
    const jsonResponse = await axios.get(apiUrl, {
      timeout: 30000,
    })

    const jsonData = jsonResponse.data

    if (Array.isArray(jsonData) && jsonData.length > 0) {
      const randomItem = _.sample(jsonData)
      const imageUrl = randomItem?.file_url

      if (imageUrl) {
        return imageUrl
      } else {
        logger.warn(`成功获取到 API 数据，但在随机选中的数据中未找到 file_url 字段。`)
        return false
      }
    } else {
      logger.warn(`成功获取 API 数据，但数据为空或格式不是预期的数组。`)
      return false
    }
  } catch (error) {
    logger.error(
      ` 请求图片 API 时出错: ${error.message}, 状态码: ${error.response ? error.response.status : "未知"}`,
    )
    return false
  }
}

export async function getgif(apiUrl) {
  if (!apiUrl || typeof apiUrl !== "string") {
    logger.error(`getgif: 未提供有效的 API URL.`)
    return false
  }

  try {
    const jsonResponse = await axios.get(apiUrl, {
      timeout: 30000,
    })

    const jsonData = jsonResponse.data

    if (
      jsonData &&
      typeof jsonData === "object" &&
      Array.isArray(jsonData.results) &&
      jsonData.results.length > 0
    ) {
      const firstItem = jsonData.results[0]
      const imageUrl = firstItem?.media_formats?.gif?.url

      if (imageUrl) {
        return imageUrl
      } else {
        logger.warn(
          `成功获取到 API 数据，但在第一个结果项中未找到预期的 media_formats.gif.url 字段。`,
        )
        return false
      }
    } else {
      logger.warn(`成功获取 API 数据，但数据格式不符合预期，未找到非空的 results 数组。`)
      return false
    }
  } catch (error) {
    logger.error(
      `请求图片 API 时出错: ${error.message}, 状态码: ${error.response ? error.response.status : "未知"}`,
    )
    return false
  }
}

export async function FlipImage(imageUrl) {
  if (!imageUrl || typeof imageUrl !== "string") {
    logger.warn("翻转图片失败：未提供有效的图片URL。")
    return false
  }

  try {
    const imageBuffer = await downloadImage(imageUrl)
    if (!imageBuffer) {
      return false
    }
    const flippedImageBuffer = await sharp(imageBuffer).flip().toBuffer()
    return flippedImageBuffer
  } catch (error) {
    logger.error(`使用 sharp 翻转图片失败: ${error}`)
    return false
  }
}

export function buildStickerMsg(file, summary = "喵") {
  const stickerMessage = {
    type: "image",
    data: {
      file: file,
      summary: summary,
      sub_type: 1,
    },
  }

  return stickerMessage
}
