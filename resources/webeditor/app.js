const API_BASE = window.location.origin

let currentConfig = null
let currentData = null
let isCategoryMode = false

let categoryCache = {}
let isLoadingCache = false

let groupList = []

async function loadGroupList() {
  try {
    groupList = await apiRequest("/api/groups")
    console.log("[WebEditor] 成功加载群列表:", groupList.length, "个群")
    if (groupList.length === 0) {
      console.warn("[WebEditor] 群列表为空，请确保 Bot 已登录")
    }
  } catch (error) {
    console.error("[WebEditor] 加载群列表失败:", error)
    groupList = []
  }
}

function showToast(message, type = "success") {
  const toast = document.createElement("div")
  toast.className = `toast ${type}`
  toast.innerHTML = `
        <span>${type === "success" ? "✓" : "✗"}</span>
        <span>${message}</span>
    `
  document.body.appendChild(toast)

  setTimeout(() => {
    toast.style.animation = "slideIn 0.3s ease-out reverse"
    setTimeout(() => toast.remove(), 300)
  }, 3000)
}

function showLoadingUI(message = "加载中...", tip = "") {
  return `
        <div class="loading-container">
            <div class="loading-spinner"></div>
            <div class="loading-text">${message}</div>
            ${tip ? `<div class="loading-tip">${tip}</div>` : ""}
        </div>
    `
}

async function apiRequest(url, options = {}) {
  try {
    console.log("[WebEditor] API 请求:", API_BASE + url)
    const response = await fetch(API_BASE + url, {
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      ...options,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = await response.json()
    console.log("[WebEditor] API 响应:", url, data)

    if (!data.success) {
      throw new Error(data.error || "请求失败")
    }
    return data.data
  } catch (error) {
    console.error("[WebEditor] API 错误:", url, error)
    showToast(error.message, "error")
    throw error
  }
}

async function loadConfigList() {
  const configTabs = document.getElementById("configTabs")

  try {
    if (typeof getCategories !== "function") {
      console.error("[WebEditor] getCategories 函数未定义，请检查 schema.js 是否正确加载")
      configTabs.innerHTML =
        '<div style="padding: 20px; text-align: center; color: #ff4d4f;">配置加载失败：schema.js 未加载</div>'
      return
    }

    const configs = await apiRequest("/api/configs")

    if (configs.length === 0) {
      configTabs.innerHTML =
        '<div style="padding: 20px; text-align: center; color: #999;">暂无配置文件</div>'
      return
    }

    const categories = getCategories()
    console.log("[WebEditor] 加载分类:", categories)

    configTabs.innerHTML = categories
      .map((cat, index) => {
        return `<div class="tab-item" data-category="${cat.name}" data-index="${index}">${cat.icon || ""} ${cat.name}</div>`
      })
      .join("")

    configTabs.querySelectorAll(".tab-item").forEach(item => {
      item.addEventListener("click", () => {
        const categoryName = item.dataset.category
        const index = parseInt(item.dataset.index)

        loadCategory(categories[index])

        configTabs.querySelectorAll(".tab-item").forEach(i => i.classList.remove("active"))
        item.classList.add("active")

        localStorage.setItem("sakura_last_category", index)
      })
    })

    preloadAllCategories(categories)

    if (categories.length > 0) {
      const lastCategory = localStorage.getItem("sakura_last_category")
      const targetIndex = lastCategory !== null ? parseInt(lastCategory) : 0

      if (targetIndex >= 0 && targetIndex < categories.length) {
        configTabs.querySelectorAll(".tab-item")[targetIndex].click()
      } else {
        configTabs.querySelector(".tab-item").click()
      }
    }
  } catch (error) {
    console.error("[WebEditor] 加载配置列表失败:", error)
    configTabs.innerHTML =
      '<div style="padding: 20px; text-align: center; color: #ff4d4f;">加载失败: ' +
      error.message +
      "</div>"
  }
}

async function preloadAllCategories(categories) {
  if (isLoadingCache) return
  isLoadingCache = true

  console.log("[WebEditor] 开始预加载所有分类配置...")

  try {
    const loadPromises = categories
      .filter(category => !categoryCache[category.name])
      .map(async category => {
        try {
          const configPromises = category.configs.map(name =>
            apiRequest(`/api/config/${name}`).then(data => ({ name, data: data.config })),
          )
          const configsData = await Promise.all(configPromises)
          categoryCache[category.name] = configsData
          console.log("[WebEditor] 预加载完成:", category.name)
        } catch (error) {
          console.error("[WebEditor] 预加载失败:", category.name, error)
        }
      })

    await Promise.all(loadPromises)
    console.log("[WebEditor] 所有分类配置预加载完成")
  } catch (error) {
    console.error("[WebEditor] 预加载过程出错:", error)
  } finally {
    isLoadingCache = false
  }
}

async function loadCategory(category) {
  const content = document.getElementById("content")
  const headerBtn = document.getElementById("headerSaveBtn")

  if (categoryCache[category.name]) {
    console.log("[WebEditor] 从缓存加载分类:", category.name)
    renderCategoryPage(category.name, categoryCache[category.name])
    return
  }

  content.innerHTML = showLoadingUI("加载配置中...", "首次加载可能需要几秒钟")

  if (headerBtn) {
    headerBtn.classList.remove("show")
  }

  try {
    console.log("[WebEditor] 开始加载分类:", category.name)

    const configPromises = category.configs.map(name =>
      apiRequest(`/api/config/${name}`).then(data => ({ name, data: data.config })),
    )

    const configsData = await Promise.all(configPromises)
    console.log("[WebEditor] 分类配置加载完成:", configsData.length, "个配置")

    categoryCache[category.name] = configsData

    renderCategoryPage(category.name, configsData)
    console.log("[WebEditor] 分类页面渲染完成")
  } catch (error) {
    console.error("[WebEditor] 加载分类失败:", error)
    content.innerHTML =
      '<div style="padding: 40px; text-align: center; color: #ff4d4f;">加载失败: ' +
      error.message +
      "<br><small>" +
      error.stack +
      "</small></div>"
  }
}

function renderCategoryPage(categoryName, configsData) {
  const content = document.getElementById("content")
  const headerBtn = document.getElementById("headerSaveBtn")

  try {
    console.log("[WebEditor] 开始渲染分类页面:", categoryName)

    console.log("[WebEditor] renderCategoryPage 设置 isCategoryMode = true")
    isCategoryMode = true

    if (headerBtn) {
      headerBtn.classList.add("show")
    }

    currentConfig = categoryName
    currentData = {}
    configsData.forEach(({ name, data }) => {
      currentData[name] = data
    })

    console.log("[WebEditor] 当前数据:", currentData)

    content.style.opacity = "0"

    setTimeout(() => {
      content.innerHTML = `
                <div class="editor-container active">
                    <div class="visual-editor" id="visualEditor">
                        ${configsData.map(({ name, data }) => renderConfigSection(name, data)).join("")}
                    </div>
                </div>
            `

      requestAnimationFrame(() => {
        content.style.transition = "opacity 0.3s ease-in-out"
        content.style.opacity = "1"
      })

      console.log("[WebEditor] 分类页面 HTML 已生成")
      console.log("[WebEditor] 检查标志 - isCategoryMode:", isCategoryMode)
    }, 150)
  } catch (error) {
    console.error("[WebEditor] 渲染分类页面失败:", error)
    content.innerHTML = `
            <div style="padding: 40px; text-align: center; color: #ff4d4f;">
                <h3>渲染失败</h3>
                <p>${error.message}</p>
                <pre style="text-align: left; background: #f5f5f5; padding: 10px; border-radius: 4px; font-size: 12px; overflow: auto;">${error.stack}</pre>
            </div>
        `
  }
}

function renderConfigSection(name, config) {
  const displayName = getConfigName(name)

  return `
        <div class="config-section" data-config="${name}">
            <div class="config-section-header">
                <h3>${displayName}</h3>
            </div>
            ${renderConfigForm(config, name)}
        </div>
    `
}

function renderEditor(name, config) {
  const content = document.getElementById("content")
  const displayName = getConfigName(name)

  console.log("[WebEditor] renderEditor 被调用，设置 isCategoryMode = false")
  isCategoryMode = false
  currentConfig = name
  currentData = config

  content.innerHTML = `
        <div class="editor-container active">
            <div class="visual-editor" id="visualEditor">
                ${renderConfigForm(config)}
            </div>
        </div>
    `
}

function renderConfigForm(config, prefix = "") {
  if (config === null || config === undefined) {
    return ""
  }

  if (Array.isArray(config)) {
    return renderArray(config, prefix)
  }

  if (typeof config === "object") {
    return Object.entries(config)
      .map(([key, value]) => {
        const fullPath = prefix ? `${prefix}.${key}` : key
        return renderField(key, value, fullPath)
      })
      .join("")
  }

  return ""
}

function renderField(key, value, path) {
  const type = typeof value
  const isArray = Array.isArray(value)
  const isObject = type === "object" && !isArray && value !== null

  const pathParts = path.split(".")
  const configName = pathParts.length > 1 ? pathParts[0] : currentConfig || ""

  const fullPathKey = configName ? `${configName}.${key}` : key
  let fieldSchema = getFieldSchema(fullPathKey)

  if (fieldSchema.label === fullPathKey) {
    fieldSchema = getFieldSchema(key)
  }

  let label = fieldSchema.label
  const fieldType = fieldSchema.type || (isArray ? "array" : isObject ? "object" : type)

  const isGroupField = fieldType === "groupSelect" || (/groups?|启用群|群组/i.test(key) && isArray)

  if (isArray) {
    if (isGroupField) {
      return `
                <div class="form-group">
                    <label>${label}</label>
                    <div class="form-control-wrapper">
                        ${renderGroupSelector(value, path)}
                        ${fieldSchema.help ? `<p style="color: #999; font-size: 12px; margin-top: 8px;">${fieldSchema.help}</p>` : ""}
                    </div>
                </div>
            `
    }
    return `
            <div class="form-group">
                <label>${label}</label>
                <div class="form-control-wrapper">
                    ${renderArray(value, path)}
                    ${fieldSchema.help ? `<p style="color: #999; font-size: 12px; margin-top: 8px;">${fieldSchema.help}</p>` : ""}
                </div>
            </div>
        `
  }

  if (isObject) {
    return `
            <div class="form-group form-group-vertical">
                <div class="object-header">${label}</div>
                <div class="nested-object">
                    ${renderConfigForm(value, path)}
                </div>
                ${fieldSchema.help ? `<p style="color: #999; font-size: 12px; margin-top: 8px;">${fieldSchema.help}</p>` : ""}
            </div>
        `
  }

  if (type === "boolean") {
    return `
            <div class="form-group">
                <label>${label}</label>
                <div class="form-control-wrapper">
                    <label class="switch-wrapper">
                        <label class="switch">
                            <input type="checkbox" data-path="${path}" ${value ? "checked" : ""} onchange="updateValue(this)">
                            <span class="slider"></span>
                        </label>
                    </label>
                    ${fieldSchema.help ? `<p style="color: #999; font-size: 12px; margin-top: 4px;">${fieldSchema.help}</p>` : ""}
                </div>
            </div>
        `
  }

  if (type === "number") {
    const attrs = [
      fieldSchema.min !== undefined ? `min="${fieldSchema.min}"` : "",
      fieldSchema.max !== undefined ? `max="${fieldSchema.max}"` : "",
      fieldSchema.step !== undefined ? `step="${fieldSchema.step}"` : 'step="any"',
    ]
      .filter(Boolean)
      .join(" ")

    return `
            <div class="form-group">
                <label>${label}${fieldSchema.required ? ' <span style="color: #ff4d4f;">*</span>' : ""}</label>
                <div class="form-control-wrapper">
                    <input type="number" data-path="${path}" value="${value}" onchange="updateValue(this)" ${attrs}>
                    ${fieldSchema.help ? `<p style="color: #999; font-size: 12px; margin-top: 4px;">${fieldSchema.help}</p>` : ""}
                </div>
            </div>
        `
  }

  if (type === "string") {
    const isMultiline = fieldType === "textarea" || value.includes("\n") || value.length > 100
    return `
            <div class="form-group">
                <label>${label}${fieldSchema.required ? ' <span style="color: #ff4d4f;">*</span>' : ""}</label>
                <div class="form-control-wrapper">
                    ${
                      isMultiline
                        ? `<textarea data-path="${path}" onchange="updateValue(this)" rows="6">${escapeHtml(value)}</textarea>`
                        : `<input type="text" data-path="${path}" value="${escapeHtml(value)}" onchange="updateValue(this)">`
                    }
                    ${fieldSchema.help ? `<p style="color: #999; font-size: 12px; margin-top: 4px;">${fieldSchema.help}</p>` : ""}
                </div>
            </div>
        `
  }

  return ""
}

function renderArray(arr, path) {
  let isObjectArray = arr.length > 0 && typeof arr[0] === "object" && !Array.isArray(arr[0])
  let isSimpleArray =
    arr.length > 0 && arr.every(item => typeof item === "string" || typeof item === "number")

  if (arr.length === 0) {
    const fieldSchema = getFieldSchema(path)
    if (fieldSchema && fieldSchema.itemType === "object") {
      isObjectArray = true
      isSimpleArray = false
    } else {
      isObjectArray = false
      isSimpleArray = true
    }
  }

  if (isSimpleArray) {
    return `
            <div class="tags-array-container" data-path="${path}">
                <div class="tags-display-area">
                    ${arr
                      .map(
                        (item, index) => `
                        <div class="array-tag" ondblclick="editSimpleArrayItem('${path}', ${index})" title="双击编辑">
                            <span class="array-tag-text">${escapeHtml(String(item))}</span>
                            <span class="array-tag-close" onclick="event.stopPropagation(); removeArrayItem('${path}', ${index})" title="删除">×</span>
                        </div>
                    `,
                      )
                      .join("")}
                </div>
                <button class="btn-add-tag" onclick="addSimpleArrayItem('${path}')">
                    <span>✚</span> 新增
                </button>
            </div>
        `
  }

  return `
        <div class="object-array-container" data-path="${path}">
            <div class="object-array-header">
                <span class="object-array-count">已配置 ${arr.length} 项</span>
                <button class="btn-add" onclick="addObjectArrayItem('${path}')" style="margin: 0;">
                    ➕ 新增
                </button>
            </div>
            <div class="object-array-list">
                ${arr.map((item, index) => renderObjectArrayCard(item, index, path)).join("")}
            </div>
        </div>
    `
}

function renderObjectArrayCard(item, index, path) {
  let titleField = ""
  let descField = ""

  if (item.sourceGroupIds && item.targetGroupIds) {
    const sourceIds = Array.isArray(item.sourceGroupIds)
      ? item.sourceGroupIds
      : [item.sourceGroupIds]
    const targetIds = Array.isArray(item.targetGroupIds)
      ? item.targetGroupIds
      : [item.targetGroupIds]

    const sourceNames = sourceIds
      .map(id => {
        const group = groupList.find(g => String(g.id) === String(id))
        return group ? `${group.name}(${id})` : id
      })
      .join(", ")

    const targetNames = targetIds
      .map(id => {
        const group = groupList.find(g => String(g.id) === String(id))
        return group ? `${group.name}(${id})` : id
      })
      .join(", ")

    titleField = `${sourceNames} → ${targetNames}`
    descField = ""
  } else if (item.reg) {
    titleField = item.reg
    descField = item.prompt || item.description || item.desc || ""
  } else {
    titleField = item.name || item.title || item.label || item.cmd || `项 ${index + 1}`
    descField = item.description || item.desc || item.Prompt || item.prompt || item.model || ""
  }

  return `
        <div class="object-card" onclick="editObjectArrayItem('${path}', ${index})">
            <div class="object-card-header">
                <div class="object-card-title">
                    <span class="object-card-icon">📋</span>
                    <span class="object-card-name">${escapeHtml(String(titleField))}</span>
                </div>
                <button class="btn-remove-card" onclick="event.stopPropagation(); removeArrayItem('${path}', ${index})" title="删除">
                    🗑️
                </button>
            </div>
            ${
              descField
                ? `
                <div class="object-card-desc">${escapeHtml(String(descField).substring(0, 100))}${String(descField).length > 100 ? "..." : ""}</div>
            `
                : ""
            }
            <div class="object-card-footer">
                <span class="object-card-hint">点击查看详情</span>
            </div>
        </div>
    `
}

function renderGroupSelector(selectedGroups, path) {
  const hasGroups = groupList.length > 0
  const pathId = path.replace(/[.\[\]]/g, "_")

  if (!hasGroups) {
    return `
            <div class="group-selector-container" data-path="${path}">
                <p style="color: #dc3545; padding: 15px; background: #fff3cd; border-radius: 6px; border-left: 4px solid #ffc107;">
                    ⚠️ 无法获取群列表，请确保：<br>
                    1. Bot 已登录<br>
                    2. 在 Yunzai 环境中运行<br>
                    3. 等待几秒后刷新页面
                </p>
                <div style="margin-top: 15px;">
                    <strong style="display: block; margin-bottom: 10px;">当前配置的群号</strong>
                    ${selectedGroups.length === 0 ? '<p style="color: #6c757d; padding: 10px;">暂无</p>' : ""}
                    ${selectedGroups
                      .map(
                        (groupId, index) => `
                        <div class="array-item" style="display: flex; justify-content: space-between; align-items: center;">
                            <span>群号: ${groupId}</span>
                            <button class="btn-remove" onclick="removeArrayItem('${path}', ${index})">删除</button>
                        </div>
                    `,
                      )
                      .join("")}
                </div>
            </div>
        `
  }

  return `
        <div class="group-selector-container" data-path="${path}">
            <div class="group-tags-container">
                ${selectedGroups
                  .map((groupId, index) => {
                    const group = groupList.find(g => String(g.id) === String(groupId))
                    const groupName = group ? group.name : `未知群 ${groupId}`
                    return `
                        <div class="group-tag">
                            <span class="group-tag-name">${groupName}</span>
                            <span class="group-tag-close" onclick="removeGroupTag('${path}', ${index})" title="移除">×</span>
                        </div>
                    `
                  })
                  .join("")}
            </div>
            <button class="btn-select-group" onclick="openGroupSelectorModal('${path}', ${JSON.stringify(selectedGroups).replace(/"/g, "&quot;")})">
                <span>✚</span> 新增
            </button>
        </div>
    `
}

function updateValue(element) {
  const path = element.dataset.path
  const value =
    element.type === "checkbox"
      ? element.checked
      : element.type === "number"
        ? parseFloat(element.value)
        : element.value

  const parts = path.split(".")
  if (
    currentData[parts[0]] !== undefined &&
    typeof currentData === "object" &&
    !Array.isArray(currentData)
  ) {
    const configName = parts[0]
    const subPath = parts.slice(1).join(".")
    setNestedValue(currentData[configName], subPath, value)
  } else {
    setNestedValue(currentData, path, value)
  }
}

function setNestedValue(obj, path, value) {
  const parts = path.split(/\.|\[|\]/).filter(Boolean)
  let current = obj

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    const nextPart = parts[i + 1]

    if (!current[part]) {
      current[part] = /^\d+$/.test(nextPart) ? [] : {}
    }
    current = current[part]
  }

  current[parts[parts.length - 1]] = value
}

function getNestedValue(obj, path) {
  const parts = path.split(/\.|\[|\]/).filter(Boolean)
  let current = obj

  for (const part of parts) {
    if (current[part] === undefined) return undefined
    current = current[part]
  }

  return current
}

function removeArrayItem(path, index) {
  const arr = getNestedValueFromCurrent(path)
  if (arr && Array.isArray(arr)) {
    arr.splice(index, 1)
    reloadCurrentView()
  }
}

function addArrayItem(path) {
  const arr = getNestedValueFromCurrent(path)
  if (arr && Array.isArray(arr)) {
    if (arr.length > 0) {
      const sample = arr[0]
      if (typeof sample === "object") {
        arr.push(JSON.parse(JSON.stringify(sample)))
      } else {
        arr.push(sample)
      }
    } else {
      arr.push("")
    }
    reloadCurrentView()
  }
}

let currentEditingArrayPath = null
let currentEditingArrayIndex = null

function addSimpleArrayItem(path) {
  currentEditingArrayPath = path
  currentEditingArrayIndex = null
  openSimpleItemModal("", "新增项")
}

function editSimpleArrayItem(path, index) {
  const arr = getNestedValueFromCurrent(path)
  if (arr && Array.isArray(arr) && arr[index] !== undefined) {
    currentEditingArrayPath = path
    currentEditingArrayIndex = index
    openSimpleItemModal(String(arr[index]), "编辑项")
  }
}

function openSimpleItemModal(initialValue, title) {
  const modal = document.getElementById("simpleItemModal")
  if (!modal) {
    createSimpleItemModal()
  }

  document.getElementById("simpleItemModalTitle").textContent = title
  document.getElementById("simpleItemInput").value = initialValue
  document.getElementById("simpleItemModal").classList.add("show")

  setTimeout(() => {
    document.getElementById("simpleItemInput").focus()
  }, 100)
}

function createSimpleItemModal() {
  const modalHTML = `
        <div id="simpleItemModal" class="modal">
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header">
                    <h3 id="simpleItemModalTitle">新增项</h3>
                    <button class="modal-close" onclick="closeSimpleItemModal()">×</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <div class="form-control-wrapper">
                            <input type="text" id="simpleItemInput" class="simple-item-input" 
                                   placeholder="请输入内容..." 
                                   onkeypress="if(event.key==='Enter') confirmSimpleItem()">
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn" onclick="closeSimpleItemModal()">取消</button>
                    <button class="btn btn-primary" onclick="confirmSimpleItem()">确定</button>
                </div>
            </div>
        </div>
    `
  document.body.insertAdjacentHTML("beforeend", modalHTML)
}

function confirmSimpleItem() {
  const input = document.getElementById("simpleItemInput")
  const value = input.value.trim()

  if (value === "") {
    showToast("内容不能为空", "error")
    return
  }

  const arr = getNestedValueFromCurrent(currentEditingArrayPath)
  if (arr && Array.isArray(arr)) {
    let valueToAdd = value
    if (arr.length > 0 && typeof arr[0] === "number") {
      const num = parseFloat(valueToAdd)
      if (isNaN(num)) {
        showToast("请输入有效的数字", "error")
        return
      }
      valueToAdd = num
    }

    if (currentEditingArrayIndex !== null) {
      arr[currentEditingArrayIndex] = valueToAdd
      showToast("修改成功", "success")
    } else {
      arr.push(valueToAdd)
      showToast("添加成功", "success")
    }

    closeSimpleItemModal()
    reloadCurrentView()
  }
}

function closeSimpleItemModal() {
  const modal = document.getElementById("simpleItemModal")
  if (modal) {
    modal.classList.remove("show")
  }
  currentEditingArrayPath = null
  currentEditingArrayIndex = null
}

let currentEditingObjectPath = null
let currentEditingObjectIndex = null
let currentEditingObjectData = null

function addObjectArrayItem(path) {
  const arr = getNestedValueFromCurrent(path)
  if (!arr || !Array.isArray(arr)) return

  let template = {}
  if (arr.length > 0) {
    const sample = arr[0]
    for (const key in sample) {
      if (typeof sample[key] === "boolean") {
        template[key] = false
      } else if (typeof sample[key] === "number") {
        template[key] = 0
      } else if (Array.isArray(sample[key])) {
        template[key] = []
      } else if (typeof sample[key] === "object") {
        template[key] = {}
      } else {
        template[key] = ""
      }
    }
  } else {
    const fieldSchema = getFieldSchema(path)

    if (fieldSchema && fieldSchema.itemType === "object" && fieldSchema.schema) {
      for (const [key, keySchema] of Object.entries(fieldSchema.schema)) {
        if (keySchema.type === "number") {
          template[key] = 0
        } else if (keySchema.type === "boolean") {
          template[key] = false
        } else if (keySchema.type === "array") {
          template[key] = []
        } else if (keySchema.type === "object") {
          template[key] = {}
        } else {
          template[key] = ""
        }
      }
    } else {
      console.warn("[addObjectArrayItem] 未找到 schema 定义，path:", path)
      template = { name: "", value: "" }
    }
  }

  currentEditingObjectPath = path
  currentEditingObjectIndex = null
  currentEditingObjectData = template
  openObjectEditorModal("新增项")
}

function editObjectArrayItem(path, index) {
  const arr = getNestedValueFromCurrent(path)
  if (!arr || !Array.isArray(arr) || !arr[index]) return

  currentEditingObjectPath = path
  currentEditingObjectIndex = index
  currentEditingObjectData = JSON.parse(JSON.stringify(arr[index]))
  openObjectEditorModal("编辑项")
}

function openObjectEditorModal(title) {
  const modal = document.getElementById("objectEditorModal")
  if (!modal) {
    createObjectEditorModal()
  }

  document.getElementById("objectEditorModalTitle").textContent = title
  renderObjectEditorForm()
  document.getElementById("objectEditorModal").classList.add("show")
}

function createObjectEditorModal() {
  const modalHTML = `
        <div id="objectEditorModal" class="modal">
            <div class="modal-content modal-large">
                <div class="modal-header">
                    <h3 id="objectEditorModalTitle">编辑项</h3>
                    <button class="modal-close" onclick="closeObjectEditorModal()">×</button>
                </div>
                <div class="modal-body" id="objectEditorModalBody">
                    <!-- 动态生成表单 -->
                </div>
                <div class="modal-footer">
                    <button class="btn" onclick="closeObjectEditorModal()">取消</button>
                    <button class="btn btn-primary" onclick="confirmObjectEdit()">保存</button>
                </div>
            </div>
        </div>
    `
  document.body.insertAdjacentHTML("beforeend", modalHTML)
}

function renderObjectEditorForm() {
  const modalBody = document.getElementById("objectEditorModalBody")
  if (!modalBody || !currentEditingObjectData) return

  modalBody.innerHTML = Object.entries(currentEditingObjectData)
    .map(([key, value]) => {
      const fieldSchema = getFieldSchema(key)
      const label = fieldSchema.label || key
      const fieldType =
        fieldSchema.type ||
        (typeof value === "boolean"
          ? "boolean"
          : typeof value === "number"
            ? "number"
            : Array.isArray(value)
              ? "array"
              : "text")

      if (fieldType === "boolean") {
        return `
                <div class="form-group">
                    <label>${label}</label>
                    <div class="form-control-wrapper">
                        <label class="switch-wrapper">
                            <label class="switch">
                                <input type="checkbox" data-obj-key="${key}" ${value ? "checked" : ""} onchange="updateObjectValue(this)">
                                <span class="slider"></span>
                            </label>
                        </label>
                        ${fieldSchema.help ? `<p style="color: #999; font-size: 12px; margin-top: 4px;">${fieldSchema.help}</p>` : ""}
                    </div>
                </div>
            `
      } else if (fieldType === "number") {
        const attrs = [
          fieldSchema.min !== undefined ? `min="${fieldSchema.min}"` : "",
          fieldSchema.max !== undefined ? `max="${fieldSchema.max}"` : "",
          fieldSchema.step !== undefined ? `step="${fieldSchema.step}"` : 'step="any"',
        ]
          .filter(Boolean)
          .join(" ")

        return `
                <div class="form-group">
                    <label>${label}${fieldSchema.required ? ' <span style="color: #ff4d4f;">*</span>' : ""}</label>
                    <div class="form-control-wrapper">
                        <input type="number" data-obj-key="${key}" value="${value}" onchange="updateObjectValue(this)" ${attrs}>
                        ${fieldSchema.help ? `<p style="color: #999; font-size: 12px; margin-top: 4px;">${fieldSchema.help}</p>` : ""}
                    </div>
                </div>
            `
      } else if (fieldType === "textarea" || (typeof value === "string" && value.length > 100)) {
        return `
                <div class="form-group">
                    <label>${label}${fieldSchema.required ? ' <span style="color: #ff4d4f;">*</span>' : ""}</label>
                    <div class="form-control-wrapper">
                        <textarea data-obj-key="${key}" onchange="updateObjectValue(this)" rows="4">${escapeHtml(String(value))}</textarea>
                        ${fieldSchema.help ? `<p style="color: #999; font-size: 12px; margin-top: 4px;">${fieldSchema.help}</p>` : ""}
                    </div>
                </div>
            `
      } else if (fieldType === "groupSelect") {
        return `
                <div class="form-group">
                    <label>${label}</label>
                    <div class="form-control-wrapper">
                        ${fieldSchema.help ? `<p style="color: #999; font-size: 12px; margin-bottom: 8px;">${fieldSchema.help}</p>` : ""}
                        <div class="modal-group-selector">
                            ${
                              Array.isArray(value) && value.length > 0
                                ? value
                                    .map(groupId => {
                                      const group = groupList.find(
                                        g => String(g.id) === String(groupId),
                                      )
                                      return group
                                        ? `<span class="group-badge">${group.name}</span>`
                                        : `<span class="group-badge">${groupId}</span>`
                                    })
                                    .join("")
                                : '<span style="color: #999;">暂未选择群聊</span>'
                            }
                            <button class="btn btn-small" onclick="selectGroupsForObject('${key}')" style="margin-top: 8px;">选择群聊</button>
                        </div>
                    </div>
                </div>
            `
      } else if (Array.isArray(value)) {
        const arrayId = `obj-array-${key}`
        const itemType = fieldSchema.itemType || "text"

        return `
                <div class="form-group" style="flex-direction: column; align-items: stretch;">
                    <label>${label}${fieldSchema.required ? ' <span style="color: #ff4d4f;">*</span>' : ""}</label>
                    ${fieldSchema.help ? `<p style="color: #999; font-size: 12px; margin-bottom: 8px;">${fieldSchema.help}</p>` : ""}
                    <div class="form-control-wrapper">
                        <div class="tags-array-container">
                            <div class="tags-display-area" id="${arrayId}">
                                ${value
                                  .map(
                                    (item, idx) => `
                                    <span class="array-tag">
                                        <span class="array-tag-text">${escapeHtml(String(item))}</span>
                                        <span class="array-tag-close" onclick="removeObjectFieldArrayItem('${key}', ${idx})">×</span>
                                    </span>
                                `,
                                  )
                                  .join("")}
                                ${value.length === 0 ? '<span style="color: #999; font-size: 13px;">暂无项目</span>' : ""}
                            </div>
                            <button type="button" class="btn-add-tag" onclick="addObjectFieldArrayItem('${key}')">
                                <span>+</span>
                                <span>添加</span>
                            </button>
                        </div>
                    </div>
                </div>
            `
      } else {
        return `
                <div class="form-group">
                    <label>${label}${fieldSchema.required ? ' <span style="color: #ff4d4f;">*</span>' : ""}</label>
                    <div class="form-control-wrapper">
                        <input type="text" data-obj-key="${key}" value="${escapeHtml(String(value))}" onchange="updateObjectValue(this)">
                        ${fieldSchema.help ? `<p style="color: #999; font-size: 12px; margin-top: 4px;">${fieldSchema.help}</p>` : ""}
                    </div>
                </div>
            `
      }
    })
    .join("")
}

function updateObjectValue(element) {
  const key = element.dataset.objKey
  if (!key || !currentEditingObjectData) return

  let value =
    element.type === "checkbox"
      ? element.checked
      : element.type === "number"
        ? parseFloat(element.value)
        : element.value

  currentEditingObjectData[key] = value
}

function addObjectFieldArrayItem(key) {
  if (!currentEditingObjectData) return

  const fieldSchema = getFieldSchema(key)
  const value = prompt("请输入要添加的内容：")

  if (value !== null && value.trim() !== "") {
    if (!Array.isArray(currentEditingObjectData[key])) {
      currentEditingObjectData[key] = []
    }
    currentEditingObjectData[key].push(value.trim())
    renderObjectEditorForm()
  }
}

function removeObjectFieldArrayItem(key, index) {
  if (!currentEditingObjectData || !Array.isArray(currentEditingObjectData[key])) return

  currentEditingObjectData[key].splice(index, 1)
  renderObjectEditorForm()
}

let currentObjectGroupSelectKey = null

function selectGroupsForObject(key) {
  currentObjectGroupSelectKey = key
  const currentValue = currentEditingObjectData[key] || []
  const selectedGroups = Array.isArray(currentValue) ? currentValue : []

  currentGroupSelectorPath = "__object_field__"
  currentSelectedGroups = [...selectedGroups]

  const modal = document.getElementById("groupSelectorModal")
  if (!modal) {
    createGroupSelectorModal()
  }

  const modalBody = document.getElementById("groupSelectorModalBody")
  if (!modalBody) return

  const selectedGroupIds = currentSelectedGroups.map(id => String(id))

  modalBody.innerHTML = `
        <div class="group-selector-modal-content">
            <div class="group-selector-header">
                <div class="search-bar">
                    <input type="text" id="groupSearchInput" placeholder="搜索群名称或群号..." onkeyup="filterGroupList()">
                </div>
                <div class="selected-count">
                    已选择 <span id="selectedGroupCount">${selectedGroupIds.length}</span> 个群
                </div>
            </div>
            <div class="group-list" id="modalGroupList">
                ${groupList
                  .map(group => {
                    const isSelected = selectedGroupIds.includes(String(group.id))
                    return `
                        <div class="group-list-item" data-group-id="${group.id}" data-group-name="${group.name}">
                            <label style="display: flex; align-items: center; padding: 12px; cursor: pointer; border-bottom: 1px solid #f0f0f0;">
                                <input type="checkbox" 
                                       value="${group.id}" 
                                       ${isSelected ? "checked" : ""} 
                                       onchange="toggleGroupSelection(this)"
                                       style="margin-right: 12px; width: 18px; height: 18px; cursor: pointer;">
                                <div style="flex: 1;">
                                    <div style="font-weight: 500; color: #333;">${group.name}</div>
                                    <div style="font-size: 12px; color: #999; margin-top: 2px;">群号: ${group.id}</div>
                                </div>
                            </label>
                        </div>
                    `
                  })
                  .join("")}
            </div>
        </div>
    `

  document.getElementById("groupSelectorModal").classList.add("show")
}

function confirmObjectEdit() {
  const arr = getNestedValueFromCurrent(currentEditingObjectPath)
  if (!arr || !Array.isArray(arr)) return

  if (currentEditingObjectIndex !== null) {
    arr[currentEditingObjectIndex] = currentEditingObjectData
    showToast("保存成功", "success")
  } else {
    arr.push(currentEditingObjectData)
    showToast("新增成功", "success")
  }

  closeObjectEditorModal()
  reloadCurrentView()
}

function closeObjectEditorModal() {
  const modal = document.getElementById("objectEditorModal")
  if (modal) {
    modal.classList.remove("show")
  }
  currentEditingObjectPath = null
  currentEditingObjectIndex = null
  currentEditingObjectData = null
}

let currentModalPath = ""
let currentModalTemplate = null

function addArrayItemWithModal(path) {
  currentModalPath = path
  const arr = getNestedValueFromCurrent(path)

  if (!arr || !Array.isArray(arr)) return

  if (arr.length > 0) {
    const sample = arr[0]
    if (typeof sample === "object" && !Array.isArray(sample)) {
      currentModalTemplate = JSON.parse(JSON.stringify(sample))
      showArrayModal(sample)
    } else {
      arr.push(typeof sample === "number" ? 0 : "")
      reloadCurrentView()
    }
  } else {
    const fieldSchema = getFieldSchema(path)

    console.log("[addArrayItemWithModal] 空数组，path:", path, "fieldSchema:", fieldSchema)

    if (fieldSchema && fieldSchema.itemType === "object" && fieldSchema.schema) {
      console.log("[addArrayItemWithModal] 从 schema 创建模板")
      const template = {}
      for (const [key, keySchema] of Object.entries(fieldSchema.schema)) {
        if (keySchema.type === "number") {
          template[key] = 0
        } else if (keySchema.type === "boolean") {
          template[key] = false
        } else if (keySchema.type === "array") {
          template[key] = []
        } else if (keySchema.type === "object") {
          template[key] = {}
        } else {
          template[key] = ""
        }
      }
      console.log("[addArrayItemWithModal] 创建的模板:", template)
      currentModalTemplate = template
      showArrayModal(template)
    } else {
      console.warn("[addArrayItemWithModal] 未找到对象数组的 schema 定义，path:", path)
      console.warn(
        '[addArrayItemWithModal] 请确保在 schema.js 中为该字段定义了 itemType: "object" 和 schema',
      )
      const defaultTemplate = { name: "" }
      currentModalTemplate = defaultTemplate
      showArrayModal(defaultTemplate)
    }
  }
}

function showArrayModal(template) {
  const modal = document.getElementById("arrayModal")
  const modalBody = document.getElementById("modalBody")

  const emptyTemplate = {}
  for (const key in template) {
    if (typeof template[key] === "number") {
      emptyTemplate[key] = 0
    } else if (typeof template[key] === "boolean") {
      emptyTemplate[key] = false
    } else if (Array.isArray(template[key])) {
      emptyTemplate[key] = []
    } else if (typeof template[key] === "object") {
      emptyTemplate[key] = {}
    } else {
      emptyTemplate[key] = ""
    }
  }

  currentModalTemplate = emptyTemplate

  modalBody.innerHTML = renderModalForm(emptyTemplate, "modal")
  modal.classList.add("show")
}

function closeArrayModal() {
  const modal = document.getElementById("arrayModal")
  modal.classList.remove("show")
  currentModalPath = ""
  currentModalTemplate = null
}

function confirmAddArrayItem() {
  if (!currentModalPath || !currentModalTemplate) return

  const arr = getNestedValueFromCurrent(currentModalPath)
  if (arr && Array.isArray(arr)) {
    arr.push(JSON.parse(JSON.stringify(currentModalTemplate)))
    closeArrayModal()
    reloadCurrentView()
    showToast("新增成功", "success")
  }
}

function renderModalForm(obj, prefix) {
  return Object.entries(obj)
    .map(([key, value]) => {
      const path = `${prefix}.${key}`
      const fieldSchema = getFieldSchema(key)
      const label = fieldSchema.label
      const type = fieldSchema.type || typeof value

      if (type === "boolean") {
        return `
                <div class="form-group">
                    <label>${label}</label>
                    <div class="form-control-wrapper">
                        <label class="switch-wrapper">
                            <label class="switch">
                                <input type="checkbox" data-modal-path="${key}" ${value ? "checked" : ""} onchange="updateModalValue(this)">
                                <span class="slider"></span>
                            </label>
                        </label>
                        ${fieldSchema.help ? `<p style="color: #999; font-size: 12px; margin-top: 4px;">${fieldSchema.help}</p>` : ""}
                    </div>
                </div>
            `
      } else if (type === "number") {
        const attrs = [
          fieldSchema.min !== undefined ? `min="${fieldSchema.min}"` : "",
          fieldSchema.max !== undefined ? `max="${fieldSchema.max}"` : "",
          fieldSchema.step !== undefined ? `step="${fieldSchema.step}"` : 'step="any"',
        ]
          .filter(Boolean)
          .join(" ")

        return `
                <div class="form-group">
                    <label>${label}${fieldSchema.required ? ' <span style="color: #ff4d4f;">*</span>' : ""}</label>
                    <div class="form-control-wrapper">
                        <input type="number" data-modal-path="${key}" value="${value}" onchange="updateModalValue(this)" ${attrs}>
                        ${fieldSchema.help ? `<p style="color: #999; font-size: 12px; margin-top: 4px;">${fieldSchema.help}</p>` : ""}
                    </div>
                </div>
            `
      } else if (type === "textarea") {
        return `
                <div class="form-group">
                    <label>${label}${fieldSchema.required ? ' <span style="color: #ff4d4f;">*</span>' : ""}</label>
                    <div class="form-control-wrapper">
                        <textarea data-modal-path="${key}" onchange="updateModalValue(this)" rows="4">${escapeHtml(String(value))}</textarea>
                        ${fieldSchema.help ? `<p style="color: #999; font-size: 12px; margin-top: 4px;">${fieldSchema.help}</p>` : ""}
                    </div>
                </div>
            `
      } else if (type === "groupSelect") {
        return `
                <div class="form-group">
                    <label>${label}${fieldSchema.required ? ' <span style="color: #ff4d4f;">*</span>' : ""}</label>
                    <div class="form-control-wrapper">
                        <p style="color: #999; font-size: 12px;">群号选择,新增后可继续编辑</p>
                    </div>
                </div>
            `
      } else if (type === "array" || Array.isArray(value)) {
        return `
                <div class="form-group">
                    <label>${label}</label>
                    <div class="form-control-wrapper">
                        <p style="color: #999; font-size: 12px;">数组类型,新增后可继续编辑</p>
                    </div>
                </div>
            `
      } else if (type === "object" || (typeof value === "object" && value !== null)) {
        return `
                <div class="form-group">
                    <label>${label}</label>
                    <div class="form-control-wrapper">
                        <p style="color: #999; font-size: 12px;">对象类型,新增后可继续编辑</p>
                    </div>
                </div>
            `
      } else {
        return `
                <div class="form-group">
                    <label>${label}${fieldSchema.required ? ' <span style="color: #ff4d4f;">*</span>' : ""}</label>
                    <div class="form-control-wrapper">
                        <input type="text" data-modal-path="${key}" value="${escapeHtml(String(value))}" onchange="updateModalValue(this)">
                        ${fieldSchema.help ? `<p style="color: #999; font-size: 12px; margin-top: 4px;">${fieldSchema.help}</p>` : ""}
                    </div>
                </div>
            `
      }
    })
    .join("")
}

function updateModalValue(element) {
  const key = element.dataset.modalPath
  const value =
    element.type === "checkbox"
      ? element.checked
      : element.type === "number"
        ? parseFloat(element.value)
        : element.value

  if (currentModalTemplate) {
    currentModalTemplate[key] = value
  }
}

function addGroupFromSelector(path) {
  const selectorId = "groupSelector_" + path.replace(/[.\[\]]/g, "_")
  const selector = document.getElementById(selectorId)
  if (!selector) return

  const groupId = selector.value
  if (!groupId) {
    showToast("请先选择一个群", "error")
    return
  }

  const arr = getNestedValueFromCurrent(path)
  if (arr && Array.isArray(arr)) {
    const valueToAdd =
      arr.length > 0 && typeof arr[0] === "number" ? Number(groupId) : String(groupId)

    if (arr.some(id => String(id) === String(groupId))) {
      showToast("该群已在列表中", "error")
      return
    }

    arr.push(valueToAdd)
    selector.value = ""
    reloadCurrentView()
    showToast("已添加群聊", "success")
  }
}

function removeGroupTag(path, index) {
  const arr = getNestedValueFromCurrent(path)
  if (arr && Array.isArray(arr)) {
    arr.splice(index, 1)
    reloadCurrentView()
    showToast("已移除群聊", "success")
  }
}

let currentGroupSelectorPath = null
let currentSelectedGroups = []

function openGroupSelectorModal(path, selectedGroups) {
  currentGroupSelectorPath = path
  currentSelectedGroups = Array.isArray(selectedGroups) ? [...selectedGroups] : []

  const modal = document.getElementById("groupSelectorModal")
  if (!modal) {
    createGroupSelectorModal()
  }

  renderGroupSelectorModal()
  document.getElementById("groupSelectorModal").classList.add("show")
}

function createGroupSelectorModal() {
  const modalHTML = `
        <div id="groupSelectorModal" class="modal">
            <div class="modal-content" style="max-width: 900px;">
                <div class="modal-header">
                    <h3>选择群聊</h3>
                    <button class="modal-close" onclick="closeGroupSelectorModal()">×</button>
                </div>
                <div class="modal-body" id="groupSelectorModalBody">
                    <!-- 动态生成内容 -->
                </div>
                <div class="modal-footer">
                    <button class="btn" onclick="closeGroupSelectorModal()">取消</button>
                    <button class="btn btn-primary" onclick="confirmGroupSelection()">确定</button>
                </div>
            </div>
        </div>
    `
  document.body.insertAdjacentHTML("beforeend", modalHTML)
}

function renderGroupSelectorModal() {
  const modalBody = document.getElementById("groupSelectorModalBody")
  if (!modalBody) return

  const arr = getNestedValueFromCurrent(currentGroupSelectorPath)
  const selectedGroupIds = Array.isArray(arr) ? arr.map(id => String(id)) : []

  modalBody.innerHTML = `
        <div class="group-selector-modal-content">
            <div class="group-selector-header">
                <div class="search-bar">
                    <input type="text" id="groupSearchInput" placeholder="搜索群名称或群号..." onkeyup="filterGroupList()">
                </div>
                <div class="selected-count">
                    已选择 <span id="selectedGroupCount">${selectedGroupIds.length}</span> 个群
                </div>
            </div>
            <div class="group-list" id="modalGroupList">
                ${groupList
                  .map(group => {
                    const isSelected = selectedGroupIds.includes(String(group.id))
                    return `
                        <div class="group-list-item" data-group-id="${group.id}" data-group-name="${group.name}">
                            <label style="display: flex; align-items: center; padding: 12px; cursor: pointer; border-bottom: 1px solid #f0f0f0;">
                                <input type="checkbox" 
                                       value="${group.id}" 
                                       ${isSelected ? "checked" : ""} 
                                       onchange="toggleGroupSelection(this)"
                                       style="margin-right: 12px; width: 18px; height: 18px; cursor: pointer;">
                                <div style="flex: 1;">
                                    <div style="font-weight: 500; color: #333;">${group.name}</div>
                                    <div style="font-size: 12px; color: #999; margin-top: 2px;">群号: ${group.id}</div>
                                </div>
                            </label>
                        </div>
                    `
                  })
                  .join("")}
            </div>
        </div>
    `
}

function filterGroupList() {
  const searchInput = document.getElementById("groupSearchInput")
  const filter = searchInput.value.toLowerCase()
  const groupItems = document.querySelectorAll(".group-list-item")

  groupItems.forEach(item => {
    const groupName = item.getAttribute("data-group-name").toLowerCase()
    const groupId = item.getAttribute("data-group-id").toLowerCase()

    if (groupName.includes(filter) || groupId.includes(filter)) {
      item.style.display = ""
    } else {
      item.style.display = "none"
    }
  })
}

function toggleGroupSelection(checkbox) {
  updateSelectedCount()
}

function updateSelectedCount() {
  const checkboxes = document.querySelectorAll('#modalGroupList input[type="checkbox"]:checked')
  const countSpan = document.getElementById("selectedGroupCount")
  if (countSpan) {
    countSpan.textContent = checkboxes.length
  }
}

function confirmGroupSelection() {
  const checkboxes = document.querySelectorAll('#modalGroupList input[type="checkbox"]:checked')
  const selectedIds = Array.from(checkboxes).map(cb => cb.value)

  if (currentGroupSelectorPath === "__object_field__" && currentObjectGroupSelectKey) {
    if (currentEditingObjectData) {
      currentEditingObjectData[currentObjectGroupSelectKey] = selectedIds.map(id =>
        isNaN(id) ? String(id) : Number(id),
      )

      const modalBody = document.getElementById("modalBody")
      if (modalBody) {
        modalBody.innerHTML = renderObjectEditorForm()
      }

      closeGroupSelectorModal()
      showToast(`已选择 ${selectedIds.length} 个群`, "success")
      currentObjectGroupSelectKey = null
    }
  } else {
    const arr = getNestedValueFromCurrent(currentGroupSelectorPath)
    if (arr && Array.isArray(arr)) {
      arr.length = 0

      selectedIds.forEach(id => {
        const valueToAdd =
          arr.length > 0 && typeof arr[0] === "number"
            ? Number(id)
            : isNaN(id)
              ? String(id)
              : Number(id)
        arr.push(valueToAdd)
      })

      closeGroupSelectorModal()
      reloadCurrentView()
      showToast(`已选择 ${selectedIds.length} 个群`, "success")
    }
  }
}

function closeGroupSelectorModal() {
  const modal = document.getElementById("groupSelectorModal")
  if (modal) {
    modal.classList.remove("show")
  }
  currentGroupSelectorPath = null
  currentSelectedGroups = []
  currentObjectGroupSelectKey = null
}

function getNestedValueFromCurrent(path) {
  const parts = path.split(/\.|\[|\]/).filter(Boolean)

  if (
    currentData[parts[0]] !== undefined &&
    typeof currentData === "object" &&
    !Array.isArray(currentData)
  ) {
    const configName = parts[0]
    const subPath = parts.slice(1)
    let current = currentData[configName]

    for (const part of subPath) {
      if (current[part] === undefined) return undefined
      current = current[part]
    }
    return current
  } else {
    return getNestedValue(currentData, path)
  }
}

function reloadCurrentView() {
  console.log("[WebEditor] reloadCurrentView 被调用")
  console.log("[WebEditor] isCategoryMode:", isCategoryMode)
  console.log("[WebEditor] currentConfig:", currentConfig)

  if (isCategoryMode) {
    console.log("[WebEditor] 重新加载分类视图")
    const configsData = Object.entries(currentData).map(([name, data]) => ({ name, data }))
    renderCategoryPage(currentConfig, configsData)
  } else {
    console.log("[WebEditor] 重新加载单文件视图")
    renderEditor(currentConfig, currentData)
  }
}

async function saveConfig() {
  if (!currentConfig) return

  const headerBtn = document.getElementById("headerSaveBtn")

  console.log("[WebEditor] saveConfig 被调用")
  console.log("[WebEditor] isCategoryMode:", isCategoryMode)
  console.log("[WebEditor] currentConfig:", currentConfig)
  console.log("[WebEditor] currentData keys:", Object.keys(currentData || {}))

  if (headerBtn) {
    headerBtn.classList.add("saving")
    headerBtn.querySelector("span:last-child").textContent = "保存中..."
  }

  try {
    if (isCategoryMode) {
      console.log("[WebEditor] 分类模式，调用 saveCategoryConfigs")
      await saveCategoryConfigs()
    } else {
      console.log("[WebEditor] 单文件模式，保存配置:", currentConfig)
      await apiRequest(`/api/config/${currentConfig}`, {
        method: "POST",
        body: JSON.stringify({ data: currentData }),
      })
      showToast("保存成功！", "success")
    }
  } catch (error) {
  } finally {
    if (headerBtn) {
      headerBtn.classList.remove("saving")
      headerBtn.querySelector("span:last-child").textContent = "保存配置"
    }
  }
}

async function saveCategoryConfigs() {
  if (!currentData || typeof currentData !== "object") return

  try {
    console.log("[WebEditor] 准备保存配置，当前数据:", Object.keys(currentData))

    const savePromises = Object.entries(currentData).map(([name, data]) => {
      console.log("[WebEditor] 保存配置文件:", name)
      return apiRequest(`/api/config/${name}`, {
        method: "POST",
        body: JSON.stringify({ data }),
      })
    })

    await Promise.all(savePromises)

    if (currentConfig && categoryCache[currentConfig]) {
      const configsData = Object.entries(currentData).map(([name, data]) => ({
        name,
        data,
      }))
      categoryCache[currentConfig] = configsData
      console.log("[WebEditor] 缓存已更新:", currentConfig)
    }

    showToast("保存成功！", "success")
  } catch (error) {}
}

async function resetConfig() {
  if (!currentConfig) return

  if (!confirm("确定要重置此配置为默认值吗？这将覆盖所有自定义设置！")) {
    return
  }

  try {
    await apiRequest(`/api/config/${currentConfig}/reset`, {
      method: "POST",
    })
    showToast("重置成功！", "success")
    await loadConfig(currentConfig)
  } catch (error) {}
}

function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }
  return String(text).replace(/[&<>"']/g, m => map[m])
}

// 简易 YAML 转换
function toYAML(obj, indent = 0) {
  const spaces = "  ".repeat(indent)

  if (obj === null || obj === undefined) {
    return "null"
  }

  if (typeof obj === "boolean") {
    return obj ? "true" : "false"
  }

  if (typeof obj === "number") {
    return String(obj)
  }

  if (typeof obj === "string") {
    // 如果包含特殊字符或换行，使用引号
    if (obj.includes("\n") || obj.includes(":") || obj.includes("#")) {
      return `"${obj.replace(/"/g, '\\"')}"`
    }
    return obj
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]"
    return (
      "\n" +
      obj
        .map(item => {
          if (typeof item === "object" && !Array.isArray(item)) {
            return (
              spaces +
              "  - " +
              toYAML(item, indent + 2)
                .trim()
                .split("\n")
                .join("\n" + spaces + "    ")
            )
          }
          return spaces + "  - " + toYAML(item, indent + 1).trim()
        })
        .join("\n")
    )
  }

  if (typeof obj === "object") {
    const entries = Object.entries(obj)
    if (entries.length === 0) return "{}"
    return (
      "\n" +
      entries
        .map(([key, value]) => {
          const valueStr = toYAML(value, indent + 1)
          if (valueStr.startsWith("\n")) {
            return spaces + "  " + key + ":" + valueStr
          }
          return spaces + "  " + key + ": " + valueStr
        })
        .join("\n")
    )
  }

  return String(obj)
}

// 简易 YAML 解析 (使用 JSON 作为中间格式)
function fromYAML(yamlStr) {
  // 简单的 YAML 转 JSON 转换
  // 这里我们尝试先转成 JSON，如果失败就抛出错误
  try {
    // 尝试作为 JSON 解析
    return JSON.parse(yamlStr)
  } catch (e) {
    // 如果不是 JSON，进行简单的 YAML 解析
    return parseSimpleYAML(yamlStr)
  }
}

// 简单的 YAML 解析器
function parseSimpleYAML(str) {
  const lines = str.split("\n")
  const result = {}
  let currentObj = result
  let stack = [{ obj: result, indent: -1 }]

  for (let line of lines) {
    // 跳过空行和注释
    if (!line.trim() || line.trim().startsWith("#")) continue

    const indent = line.search(/\S/)
    const content = line.trim()

    // 处理键值对
    const match = content.match(/^([^:]+):\s*(.*)$/)
    if (match) {
      const [, key, value] = match

      // 弹出栈直到找到合适的父级
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
        stack.pop()
      }

      currentObj = stack[stack.length - 1].obj

      if (value) {
        // 有值
        currentObj[key.trim()] = parseValue(value)
      } else {
        // 无值，可能是对象或数组
        currentObj[key.trim()] = {}
        stack.push({ obj: currentObj[key.trim()], indent })
      }
    }
  }

  return result
}

function parseValue(str) {
  str = str.trim()

  if (str === "true") return true
  if (str === "false") return false
  if (str === "null") return null
  if (/^-?\d+$/.test(str)) return parseInt(str)
  if (/^-?\d+\.\d+$/.test(str)) return parseFloat(str)
  if (str.startsWith('"') && str.endsWith('"')) return str.slice(1, -1)
  if (str.startsWith("'") && str.endsWith("'")) return str.slice(1, -1)

  return str
}

// 暴露全局函数供 HTML onclick 调用
window.saveConfig = saveConfig
window.saveCategoryConfigs = saveCategoryConfigs
window.resetConfig = resetConfig
window.updateValue = updateValue
window.addArrayItemWithModal = addArrayItemWithModal
window.addSimpleArrayItem = addSimpleArrayItem
window.editSimpleArrayItem = editSimpleArrayItem
window.closeSimpleItemModal = closeSimpleItemModal
window.confirmSimpleItem = confirmSimpleItem
window.addObjectArrayItem = addObjectArrayItem
window.editObjectArrayItem = editObjectArrayItem
window.closeObjectEditorModal = closeObjectEditorModal
window.updateObjectValue = updateObjectValue
window.selectGroupsForObject = selectGroupsForObject
window.confirmObjectEdit = confirmObjectEdit
window.removeArrayItem = removeArrayItem
window.addGroupFromSelector = addGroupFromSelector
window.removeGroupTag = removeGroupTag
window.openGroupSelectorModal = openGroupSelectorModal
window.closeGroupSelectorModal = closeGroupSelectorModal
window.toggleGroupSelection = toggleGroupSelection
window.confirmGroupSelection = confirmGroupSelection
window.filterGroupList = filterGroupList
window.showArrayModal = showArrayModal
window.closeArrayModal = closeArrayModal
window.updateModalValue = updateModalValue
window.confirmAddArrayItem = confirmAddArrayItem

// 页面加载完成后初始化
document.addEventListener("DOMContentLoaded", () => {
  console.log("[WebEditor] ========== 开始初始化 ==========")
  console.log("[WebEditor] 页面加载完成")
  console.log("[WebEditor] API_BASE:", API_BASE)
  console.log("[WebEditor] 检查 schema 函数:", {
    getCategories: typeof getCategories,
    getConfigName: typeof getConfigName,
    getFieldSchema: typeof getFieldSchema,
    configSchema: typeof configSchema,
  })

  // 如果 schema 未加载，显示错误
  if (typeof getCategories !== "function") {
    const content = document.getElementById("content")
    if (content) {
      content.innerHTML = `
                <div style="text-align: center; padding: 100px 20px;">
                    <div style="font-size: 48px; margin-bottom: 16px;">❌</div>
                    <h3 style="margin: 0 0 8px 0; color: #ff4d4f;">Schema 加载失败</h3>
                    <p style="margin: 0 0 16px 0; font-size: 14px; color: #999;">配置定义文件未正确加载</p>
                    <p style="font-size: 12px; color: #666;">请检查浏览器控制台了解详情</p>
                    <button onclick="location.reload()" style="margin-top: 20px; padding: 8px 16px; background: #1890ff; color: white; border: none; border-radius: 4px; cursor: pointer;">
                        刷新页面
                    </button>
                </div>
            `
    }
    console.error("[WebEditor] schema.js 未正确加载，请检查文件路径和内容")
    return
  }

  loadGroupList()
    .then(() => {
      console.log("[WebEditor] 群列表加载完成，开始加载配置列表")
      loadConfigList()
    })
    .catch(err => {
      console.error("[WebEditor] 初始化失败:", err)
      const content = document.getElementById("content")
      if (content) {
        content.innerHTML = `
                <div style="text-align: center; padding: 100px 20px;">
                    <div style="font-size: 48px; margin-bottom: 16px;">❌</div>
                    <h3 style="margin: 0 0 8px 0; color: #ff4d4f;">初始化失败</h3>
                    <p style="margin: 0 0 16px 0; font-size: 14px; color: #999;">${err.message}</p>
                    <button onclick="location.reload()" style="margin-top: 20px; padding: 8px 16px; background: #1890ff; color: white; border: none; border-radius: 4px; cursor: pointer;">
                        刷新页面
                    </button>
                </div>
            `
      }
    })

  console.log("[WebEditor] ========== 初始化完成 ==========")
})
