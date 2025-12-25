require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const OSS = require('ali-oss');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 3000;

// 从环境变量获取配置（确保 .env 文件中配置正确）
const {
  OSS_REGION,
  OSS_BUCKET,
  OSS_ACCESS_KEY_ID,
  OSS_ACCESS_KEY_SECRET
} = process.env;

// 校验环境变量（缺一不可）
if (!OSS_REGION || !OSS_BUCKET || !OSS_ACCESS_KEY_ID || !OSS_ACCESS_KEY_SECRET) {
  throw new Error('Missing required OSS environment variables. Please set OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET.');
}

const ossClient = new OSS({
  region: OSS_REGION,
  accessKeyId: OSS_ACCESS_KEY_ID,
  accessKeySecret: OSS_ACCESS_KEY_SECRET,
  bucket: OSS_BUCKET
});


// 配置跨域（允许小程序请求）
app.use(cors({
  origin: '*', // 开发环境用 *，生产环境替换为你的小程序域名（如 https://xxx.weixin.qq.com）
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json({ limit: '2mb' })); // 解析 JSON 格式的请求体

// 生成 OSS PUT Authorization Header
app.get('/api/oss/sign-put', (req, res) => {
  try {
    const { filename, contentType = 'application/octet-stream' } = req.query;
    if (!filename) {
      return res.status(400).json({ code: 400, message: 'filename is required' });
    }

    const safeContentType = contentType || 'application/octet-stream';
    const gmtDate = new Date().toGMTString();
    const canonicalizedResource = `/${OSS_BUCKET}/${filename}`;

    // StringToSign 必须严格按照文档的行顺序拼接
    const stringToSign = [
      'PUT',          // HTTP Verb
      '',             // Content-MD5 为空
      safeContentType,
      gmtDate,
      canonicalizedResource,
    ].join('\n');

    const signature = crypto
      .createHmac('sha1', OSS_ACCESS_KEY_SECRET)
      .update(stringToSign)
      .digest('base64');

    const authorization = `OSS ${OSS_ACCESS_KEY_ID}:${signature}`;
    const uploadUrl = `https://${OSS_BUCKET}.${OSS_REGION}.aliyuncs.com/${filename}`;
    const publicUrl = `https://${OSS_BUCKET}.${OSS_REGION}.aliyuncs.com/${encodeURIComponent(filename)}`;

    res.json({
      code: 200,
      data: {
        uploadUrl,
        headers: {
          Authorization: authorization,
          Date: gmtDate,
          'Content-Type': safeContentType,
        },
        publicUrl,
        objectKey: filename,
      },
    });
  } catch (error) {
    console.error('生成 OSS Authorization Header 失败：', error);
    res.status(500).json({ code: 500, message: '生成签名失败', error: error.message });
  }
});

app.listen(port, () => {
  console.log(`OSS sign service listening on http://localhost:${port}`);
});
