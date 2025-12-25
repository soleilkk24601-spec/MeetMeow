// Dify 图片理解工作流配置
const IMAGE_DIFY_API = {
  url: 'https://api.dify.ai/v1/workflows/run', 
  apiKey: 'app-T8Z4R2ziYRTLIys8ERWa3g0v'       
};

// Dify 故事工作流配置
const INTERACTION_DIFY_API = {
  url: 'https://api.dify.ai/v1/workflows/run', 
  apiKey: 'app-BaA1wsEhXSmI7FJ2SMCuxKbL'  
};

// Nano Banana 编辑接口
const QWEN_API = {
  url: 'https://api.vectorengine.ai/v1/images/generations',
  apiKey: 'sk-qYGm0hyBHzaP49IHJvQM2PoUkYTPnofK0iqRN0eUmtO0Jil2'
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
        prompt: '治愈系卡通小猫风格：线条简洁流畅，造型圆润软萌，色彩柔和低饱和（马卡龙色系）。胡须用浅色几笔带过。眼睛是黑色实心椭圆形，带一点白色高光。还原小猫姿势。整体温馨治愈，还原真实小猫萌态与毛色、姿势等显著特征，风格统一于可爱系。白色背景。线条风格：采用0.5像素的黑色细轮廓线，均匀流畅。',
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
          generatedUrl = `data:image/png;base64,${generatedBase64}`;
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
