require('dotenv').config();
const fetch = require('node-fetch');

/**
 * LLM 클라이언트 모듈
 * Ollama와 OpenAI를 지원하는 통합 LLM 호출 인터페이스
 */

// LLM 제공자 설정
const LLM_PROVIDER = process.env.LLM_PROVIDER || 'ollama';

// Ollama 설정
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gpt-oss:20b';

// OpenAI 설정
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * LLM 호출 함수
 * @param {string} prompt - 전송할 프롬프트
 * @param {object} options - 옵션 { model, temperature, maxTokens, provider }
 * @returns {Promise<string>} LLM 응답
 */
async function callLLM(prompt, options = {}) {
  const {
    model = null,
    temperature = 0.7,
    maxTokens = 4096,
    provider = LLM_PROVIDER
  } = options;

  try {
    if (provider === 'openai') {
      return await callOpenAI(prompt, { model, temperature, maxTokens });
    } else {
      return await callOllama(prompt, { model, temperature, maxTokens });
    }
  } catch (err) {
    console.error('LLM call error:', err);
    
    // 사용자 친화적 에러 메시지
    if (err.code === 'ECONNREFUSED') {
      throw new Error(
        `LLM 서버에 연결할 수 없습니다. ${
          provider === 'openai' 
            ? 'OpenAI API' 
            : `Ollama (${OLLAMA_HOST})`
        }가 실행 중인지 확인해주세요.`
      );
    } else if (err.code === 'ETIMEDOUT' || err.message.includes('timeout')) {
      throw new Error('요청 시간이 초과되었습니다. 네트워크 연결을 확인하거나 다시 시도해주세요.');
    }
    
    throw err;
  }
}

/**
 * OpenAI API 호출
 * @private
 */
async function callOpenAI(prompt, options) {
  const { model, temperature, maxTokens } = options;

  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY가 설정되지 않았습니다. 환경변수를 확인해주세요.');
  }

  console.log(`Calling OpenAI API with model: ${model || OPENAI_MODEL}`);
  
  const resp = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: model || OPENAI_MODEL,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature,
      max_tokens: maxTokens
    })
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    console.error('OpenAI API error:', errorText);
    throw new Error(`OpenAI API 오류 (${resp.status}): ${errorText.substring(0, 200)}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || '';
  
  if (!content) {
    throw new Error('OpenAI API로부터 응답을 받지 못했습니다.');
  }
  
  return content;
}

/**
 * Ollama 로컬 서버 호출
 * @private
 */
async function callOllama(prompt, options) {
  const { model, temperature, maxTokens } = options;

  console.log(`Calling Ollama with model: ${model || OLLAMA_MODEL}`);
  
  const resp = await fetch(`${OLLAMA_HOST.replace(/\/$/, '')}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || OLLAMA_MODEL,
      prompt: prompt,
      stream: false,
      options: {
        temperature,
        num_predict: maxTokens
      }
    })
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    console.error('Ollama error:', errorText);
    
    if (resp.status === 404) {
      throw new Error(
        `Ollama 모델 '${model || OLLAMA_MODEL}'을 찾을 수 없습니다. 모델이 설치되어 있는지 확인해주세요.`
      );
    }
    
    throw new Error(`Ollama 오류 (${resp.status}): ${errorText.substring(0, 200)}`);
  }

  const data = await resp.json();
  const content = data.response || '';
  
  if (!content) {
    throw new Error('Ollama로부터 응답을 받지 못했습니다.');
  }
  
  return content;
}

/**
 * 설정 정보 반환
 */
function getConfig() {
  return {
    provider: LLM_PROVIDER,
    model: LLM_PROVIDER === 'openai' ? OPENAI_MODEL : OLLAMA_MODEL,
    host: LLM_PROVIDER === 'openai' ? 'OpenAI API' : OLLAMA_HOST,
    hasApiKey: LLM_PROVIDER === 'openai' ? !!OPENAI_API_KEY : true
  };
}

module.exports = {
  callLLM,
  getConfig,
  // 상수 export
  LLM_PROVIDER,
  OLLAMA_HOST,
  OLLAMA_MODEL,
  OPENAI_MODEL
};

