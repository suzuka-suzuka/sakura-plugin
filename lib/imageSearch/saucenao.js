import { SEARCH_CHANNELS } from './constants.js'
import { fetchImageBlob } from './helpers.js'


export async function searchSauceNao(imgUrl, apiKey = DEFAULT_SAUCENAO_API_KEY) {
  
  const effectiveApiKey = apiKey 
  const fileBlob = await fetchImageBlob(imgUrl)

  const formData = new FormData()
  formData.append('api_key', effectiveApiKey)
  formData.append('output_type', '2')
  formData.append('numres', '5')
  formData.append('file', fileBlob, 'image.jpg')

  const response = await fetch('https://saucenao.com/search.php', {
    method: 'POST',
    body: formData,
  })

  const text = await response.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('解析 SauceNAO 返回结果为空或非合法 JSON 格式')
  }

  if (data.header && Number(data.header.status) > 0) {
    throw new Error(`SauceNAO 返回错误信息: 状态码 ${data.header.status}`)
  }

  return {
    channel: SEARCH_CHANNELS.SAUCENAO,
    items: (data.results || []).map(item => ({
      similarity: item.header?.similarity,
      thumb: item.header?.thumbnail,
      title: item.data?.title || item.data?.source || item.data?.jp_name || item.data?.eng_name || '未知来源',
      author: Array.isArray(item.data?.creator)
        ? item.data.creator.join(', ')
        : item.data?.creator || item.data?.member_name || '',
      authorId: item.data?.member_id || '',
      url: item.data?.ext_urls?.[0] || '',
      raw: item,
    })),
  }
}
