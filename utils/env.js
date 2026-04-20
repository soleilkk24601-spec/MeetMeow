let localEnv = {};

try {
  localEnv = require('./env.local');
} catch (err) {
  localEnv = {};
}

module.exports = {
  IMAGE_DIFY_API_URL: localEnv.IMAGE_DIFY_API_URL || 'https://api.dify.ai/v1/workflows/run',
  IMAGE_DIFY_API_KEY: localEnv.IMAGE_DIFY_API_KEY || '',
  INTERACTION_DIFY_API_URL: localEnv.INTERACTION_DIFY_API_URL || 'https://api.dify.ai/v1/workflows/run',
  INTERACTION_DIFY_API_KEY: localEnv.INTERACTION_DIFY_API_KEY || '',
  QWEN_API_URL: localEnv.QWEN_API_URL || 'https://api.vectorengine.ai/v1/images/generations',
  QWEN_API_KEY: localEnv.QWEN_API_KEY || '',
  CHATFLOW_API_URL: localEnv.CHATFLOW_API_URL || 'https://api.dify.ai/v1/chat-messages',
  CHATFLOW_API_KEY: localEnv.CHATFLOW_API_KEY || ''
};