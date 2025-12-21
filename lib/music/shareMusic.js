const wyck =
  "009C03507450CFA73E6D3F6F011ADC47E45AC72CD7A9B27D5CD9461D20BB24DE3C8EB02D78A83B2B07EB4BF662B38B3D3ADB8EC5C771CBA47C5CE66E1F6575AE82DC2ACFE9D9AE6471986C1F0244A4D84127EDEEEF584460522EF0C5E5E483E4BEFCF659530BCE749E8CF31D3DC0CCDA7725B8A72054034FFAA17380A73C6B02A183B8BF015675CD936D120B45B3391C980F0569676E09F33965130A445DAFC45D0888B08EA9DBFB1A0F3FCDA87A94D23D963B1548A6BCB5B38B9F6AA5B3E73C37BFEDB6651BCE3EB195A7DAE6E238A22E9EB73DF03EFA7BF883418FD6890E96F7CF712EB5F6C4E92B37741B7F694465ABD08BDA887EECE30BA28A6B4A7CE23DCBE47896D8B8D09485F653670055738F8D562498EECE530239D163C0AC1B63C7C4D6A3163FC4E5FC7C3377A0AB3C7A9CEA9ADBF5CF150D77C327BE72006917817500F43B7C229D40582D5EE1F5A250697BC19DF53D47F3CCCC8F407EE2F9ADFA1CF85D12A6D8863588C441A6E83A64C18FAF39BC7E64A08347E463F605844D008BD34DB0064716A885ADE022DA75F153B1F808216CECC895C81BD420F1E39B18BA"

async function playNeteaseMusic(e, id) {
  try {
    let detailUrl = `http://datukuai.top:3000/song/detail?ids=${id}`
    let detailResponse = await fetch(detailUrl)
    let detailData = await detailResponse.json()
    if (!detailData.songs || detailData.songs.length === 0) {
      throw new Error("未找到该歌曲")
    }
    let song = detailData.songs[0]
    let name = song.name
    let artist = song.ar[0].name
    let pic = song.al.picUrl
    let link = `https://music.163.com/#/song?id=${id}`

    let options = {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 12; MI Build/SKQ1.211230.001)",
        Cookie:
          "versioncode=8008070; os=android; channel=xiaomi; ;appver=8.8.70; " + "MUSIC_U=" + wyck,
      },
      body: `ids=${JSON.stringify([id])}&level=standard&encodeType=mp3`,
    }
    let urlResponse = await fetch("https://music.163.com/api/song/enhance/player/url/v1", options)
    let urlData = await urlResponse.json()
    let url = ""
    if (urlData.code == 200) {
      url = urlData.data[0]?.url || ""
    }
    if (!url) {
      throw new Error("无法获取播放链接")
    }

    await SendMusicShare(e, { source: "netease", name, artist, pic, link, url })
  } catch (error) {
    throw new Error("点歌失败，请稍后重试")
  }
}

async function SendMusicShare(e, data, to_uin = null) {
  if (!e.bot.sendOidb) return false

  let appid,
    appname,
    appsign,
    style = 4
  switch (data.source) {
    case "netease":
      ;((appid = 100495085),
        (appname = "com.netease.cloudmusic"),
        (appsign = "da6b069da1e2982db3e386233f68d76d"))
      break
    case "kuwo":
      ;((appid = 100243533),
        (appname = "cn.kuwo.player"),
        (appsign = "bf9ff4ffb4c558a34ee3fd52c223ebf5"))
      break
    case "kugou":
      ;((appid = 205141),
        (appname = "com.kugou.android"),
        (appsign = "fe4a24d80fcf253a00676a808f62c2c6"))
      break
    case "migu":
      ;((appid = 1101053067),
        (appname = "cmccwm.mobilemusic"),
        (appsign = "6cdc72a439cef99a3418d2a78aa28c73"))
      break
    case "qq":
    default:
      ;((appid = 100497308),
        (appname = "com.tencent.qqmusic"),
        (appsign = "cbd27cd7c861227d013a25b2d10f0799"))
      break
  }

  var title = data.name,
    singer = data.artist,
    prompt = "[分享]",
    jumpUrl,
    preview,
    musicUrl

  let types = []
  if (data.url == null) {
    types.push("url")
  }
  if (data.pic == null) {
    types.push("pic")
  }
  if (data.link == null) {
    types.push("link")
  }
  if (types.length > 0 && typeof data.api == "function") {
    let { url, pic, link } = await data.api(data.data, types)
    if (url) {
      data.url = url
    }
    if (pic) {
      data.pic = pic
    }
    if (link) {
      data.link = link
    }
  }

  typeof data.url == "function" ? (musicUrl = await data.url(data.data)) : (musicUrl = data.url)
  typeof data.pic == "function" ? (preview = await data.pic(data.data)) : (preview = data.pic)
  typeof data.link == "function" ? (jumpUrl = await data.link(data.data)) : (jumpUrl = data.link)

  if (typeof musicUrl != "string" || musicUrl == "") {
    style = 0
    musicUrl = ""
  }

  prompt = "[分享]" + title + "-" + singer

  let recv_uin = 0
  let send_type = 0
  let recv_guild_id = 0
  let ShareMusic_Guild_id = false

  if (e.group_id && to_uin == null) {
    recv_uin = e.group.gid
    send_type = 1
  } else if (e.guild_id) {
    recv_uin = Number(e.channel_id)
    recv_guild_id = BigInt(e.guild_id)
    send_type = 3
  } else if (to_uin == null) {
    recv_uin = e.friend.uid
    send_type = 0
  } else {
    recv_uin = to_uin
    send_type = 0
  }

  let body = {
    1: appid,
    2: 1,
    3: style,
    5: {
      1: 1,
      2: "0.0.0",
      3: appname,
      4: appsign,
    },
    10: send_type,
    11: recv_uin,
    12: {
      10: title,
      11: singer,
      12: prompt,
      13: jumpUrl,
      14: preview,
      16: musicUrl,
    },
    19: recv_guild_id,
  }

  let payload = await e.bot.sendOidb("OidbSvc.0xb77_9", core.pb.encode(body))

  let result = core.pb.decode(payload)

  if (result[3] != 0) {
    throw new Error("歌曲分享失败：" + result[3])
  }
}

export { playNeteaseMusic }
