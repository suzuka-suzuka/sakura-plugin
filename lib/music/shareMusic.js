const wyck =
  "0050705497FF5123F4341A4B3A03817F1AA12AED60AEDC0D0877CE692D0CF08D06E45D2864FF1F61279CA7FA1337EF37F500DBB94BD186EF01E1D2F3153276C3CD2BBD407D6B929F55FAE52761DC6C669BDD15B8D1671B13B5536BD3D10E63B8910CF7C86FFD1EF0715F6E1A16398CDECE1A40DA4F0042A5D9378FA0FD102E3F5CF5C33CB779A37B0789421AB2C5C22D67634D2D105B4A2FDB02F62E88F9652EF8600640394A5116594682B1B4E9A52061B81AF945ED21F8EE99B53767039E0669BB61E6203BDD1A3A6CE95B11DA6F2E1A8ECD59AFA8184BB6D3BB3CE807589265023165250D59FBA2F5D756F4DC65DF60A9DBFBEE64135ED944F478FE9F45D9FACF4DB1A6744F8AEDA04730BC8AFE5A7D82CE20E77C75660208EA1774A92541542924221622AAB0F7C08156D1039CFC19A229D5C99CA59E463760CFDC951606853DC16BE0A50C70E5745881B1E439F609"

import adapter from "../adapter.js"

async function playNeteaseMusic(e, id) {
  try {
    if (adapter === 1) {
      const musicMsgObject = {
        type: "music",
        data: {
          type: "163",
          id: id,
        },
      }
      await e.reply(musicMsgObject)
    }

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

  if (e.isGroup && to_uin == null) {
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
