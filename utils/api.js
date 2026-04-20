const runtimeEnv = require('./env');

// Dify 图片理解工作流配置
const IMAGE_DIFY_API = {
  url: runtimeEnv.IMAGE_DIFY_API_URL,
  apiKey: runtimeEnv.IMAGE_DIFY_API_KEY
};

// Dify 故事工作流配置
const INTERACTION_DIFY_API = {
  url: runtimeEnv.INTERACTION_DIFY_API_URL,
  apiKey: runtimeEnv.INTERACTION_DIFY_API_KEY
};

// Nano Banana 编辑接口
const QWEN_API = {
  url: runtimeEnv.QWEN_API_URL,
  apiKey: runtimeEnv.QWEN_API_KEY
};



/**
 * 调用 Dify 图片理解工作流
 * @param {{ imageUrl: string,  userId?: string }} payload
 * @returns {Promise<string>} 返回结构化 JSON 字符串
 */
function callImageWorkflow(payload = {}) {
  const { imageUrl, userPrompt = '', userId = 'cat_tester' } = payload;

  if (!imageUrl) {
    return Promise.reject(new Error('缺少图片 URL'));
  }
  if (!IMAGE_DIFY_API.apiKey) {
    return Promise.reject(new Error('缺少 IMAGE_DIFY_API_KEY'));
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: IMAGE_DIFY_API.url,
      method: 'POST',
      header: {
        'Authorization': `Bearer ${IMAGE_DIFY_API.apiKey}`,
        'Content-Type': 'application/json'
      },
      data: {
        inputs: {
          image: {
            type: 'image',
            transfer_method: 'remote_url',
            remote_url: imageUrl
    },
        },
        response_mode: 'blocking',
        user: userId
      },
      success(res) {
        const { statusCode, data } = res || {};
        if (statusCode !== 200 || !data) {
          reject(new Error(data?.error || '图片理解工作流请求失败'));
          return;
        }

        const workflowData = data?.data && typeof data.data === 'object' ? data.data : data;
        const status = workflowData?.status || data?.status;
        if (status && status !== 'succeeded') {
          reject(new Error('AI 正在处理中'));
          return;
        }

        const text = (extractWorkflowText(data) || '').trim();
        if (!text) {
          reject(new Error('AI 无内容返回'));
          return;
        }

        resolve(text);
      },
      fail(err) {
        reject(new Error(err.errMsg || '图片工作流网络异常'));
      }
    });
  });
}

/**
 * 调用 Dify 共创故事工作流
 * @param {{ audio?: string, text?: string, imageUrl?: string }} options
 * @returns {Promise<string>} 返回处理后的文本内容
 */
function callInteractionWorkflow(options = {}) {
  const { audio, text, imageUrl } = options;
  const hasAudio = typeof audio === 'string' && audio.trim().length > 0;   // 是否包含音频
  const hasText = typeof text === 'string' && text.trim().length > 0;      // 是否包含文本

  if (!hasAudio && !hasText) {
    return Promise.reject(new Error('请提供文本或语音内容'));
  }
  if (!INTERACTION_DIFY_API.apiKey) {
    return Promise.reject(new Error('缺少 INTERACTION_DIFY_API_KEY'));
  }

  const sanitizedImage = typeof imageUrl === 'string' ? imageUrl.trim() : '';
  if (!sanitizedImage) {
    return Promise.reject(new Error('缺少猫咪图片 URL'));
  }

  const inputs = {};
  if (hasAudio) {
    inputs.audio = {
      type: 'audio',
      transfer_method: 'remote_url',
      remote_url: audio.trim()
    };
  }

  if (hasText) {
    inputs.text = text.trim();
  }

  inputs.image = {
    type: 'image',
    transfer_method: 'remote_url',
    remote_url: sanitizedImage
  };
  
  return new Promise((resolve, reject) => {
    wx.request({
      url: INTERACTION_DIFY_API.url,
      method: 'POST',
      header: {
        'Authorization': `Bearer ${INTERACTION_DIFY_API.apiKey}`,
        'Content-Type': 'application/json'
      },
      data: {
        inputs,
        response_mode: 'blocking',
        user: 'cat_interaction_user'
      },
      success(res) {
        if (res.statusCode !== 200 || !res.data) {
          reject(new Error(res.data?.error || '共创故事工作流请求失败'));
          return;
        }

        const rawText = (extractWorkflowText(res.data) || '').trim();
        let payload = null;
        if (rawText) {
          try {
            payload = JSON.parse(rawText);
          } catch (err) {
            console.warn('工作流返回非 JSON 文本', rawText);
          }
        }

        const normalized = {
          error: payload?.error || '',
          au_text: payload?.au_text || '',
          story: payload?.story || rawText,
          raw_text: rawText
        };

        resolve(normalized);
      },
      fail(err) {
        reject(new Error(err.errMsg || '共创故事工作流网络异常'));
      }
    });
  });
}


// 提取 Dify 工作流的文本输出
function extractWorkflowText(payload) {
  if (!payload) {
    return '';
  }

  const dataNode = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  if (dataNode.outputs && dataNode.outputs.text) {
    return dataNode.outputs.text;
  }

  if (payload.outputs && payload.outputs.text) {
    return payload.outputs.text;
  }

  return '';
}

/**
 * 调用 Qwen 图像生成接口
 * 仅传入 prompt + 单张参考图，输出 1 张结果图
 */
function callQwenGeneration(options = {}) {
  const {
    imageUrl,
    prompt,
    model
  } = options;

  const sanitizedImage = typeof imageUrl === 'string' ? imageUrl.trim() : '';
  if (!sanitizedImage) {
    return Promise.reject(new Error('缺少猫咪图片 URL'));
  }
  if (!QWEN_API.apiKey) {
    return Promise.reject(new Error('缺少 QWEN_API_KEY'));
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: QWEN_API.url,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${QWEN_API.apiKey}`
      },
      data: {
        model,
        prompt: `
      将上传的真实小猫照片，转换为简约清新的手绘插画风格
      核心保留：
      1. 严格还原原图中小猫的毛色、花纹细节
      2. 严格还原原图中小猫的肢体动作与姿态
      风格特征：
      1. 线条简洁流畅（无复杂笔触）
      2. 边缘柔和圆润
      3. 配色沿用原图猫咪的真实色彩（仅做手绘质感的柔和化处理）
      细节调整：
      1. 将小猫的表情优化为自然放松的状态
      2. 可微调为温和的神态
      3. 画风干净无多余装饰
      呈现效果：
      1. 背景为纯素色（白色 / 浅灰）
      2. 仅保留小猫主体
      3. 添加极淡的投影增强轻盈感
      4. 整体视觉简洁治愈、质感统一
        `,
        image: sanitizedImage
      },
      success(res) {
        const { statusCode, data } = res || {};
        if (statusCode !== 200 || !data) {
          reject(new Error(data?.error || data?.message || 'Qwen 接口请求失败'));
          return;
        }

        let generatedUrl =
          data?.data?.image_url ||
          data?.image_url ||
          data?.result?.image_url ||
          data?.data?.images?.[0]?.url ||
          data?.images?.[0] ||
          data?.data?.[0]?.url;

        const generatedBase64 =
          data?.data?.images?.[0]?.b64_json ||
          data?.images?.[0]?.b64_json ||
          data?.data?.[0]?.b64_json ||
          data?.data?.[0]?.b64;

        if (!generatedUrl && generatedBase64) {
          generatedUrl = `https://meetmeow.oss-cn-wuhan-lr.aliyuncs.com/images/1766907188086-5qdagl.jpg;base64,${generatedBase64}`;
        }

        if (!generatedUrl) {
          console.warn('Qwen 返回但缺少图片 URL 字段', data);
          reject(new Error('Qwen 暂无生成结果'));
          return;
        }

        resolve({
          imageUrl: generatedUrl,
          raw: data
        });
      },
      fail(err) {
        reject(new Error(err?.errMsg || 'Qwen 接口网络异常'));
      }
    });
  });
}



module.exports = {
  callImageWorkflow,
  callInteractionWorkflow,
  callQwenGeneration,
  IMAGE_DIFY_API,
  INTERACTION_DIFY_API,
  QWEN_API
};
