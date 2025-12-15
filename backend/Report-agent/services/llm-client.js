require('dotenv').config();
const fetch = require('node-fetch');

/**
 * LLM 클라이언트 모듈
 * Ollama와 OpenAI를 지원하는 통합 LLM 호출 인터페이스
 */

// LLM 제공자 설정 (환경변수로 관리)
const LLM_PROVIDER = process.env.LLM_PROVIDER;

// Ollama 설정 (환경변수)
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gpt-oss:20b';

// OpenAI 설정 (환경변수) - API 키는 반드시 .env에서 설정
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL;
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

  const modelName = model || OPENAI_MODEL;
  console.log(`Calling OpenAI API with model: ${modelName}`);
  
  // 새로운 모델들 (o1, o3, gpt-5 등)은 max_completion_tokens 사용
  const isNewModel = modelName.startsWith('o1') || 
                     modelName.startsWith('o3') || 
                     modelName.includes('gpt-5');
  
  const requestBody = {
    model: modelName,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  };

  // 모델에 따라 파라미터 설정
  if (isNewModel) {
    // 새 모델: max_completion_tokens 사용, temperature 미지원
    requestBody.max_completion_tokens = maxTokens;
  } else {
    // 기존 모델: max_tokens, temperature 사용
    requestBody.max_tokens = maxTokens;
    requestBody.temperature = temperature;
  }

  const resp = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    console.error('OpenAI API error:', errorText);
    throw new Error(`OpenAI API 오류 (${resp.status}): ${errorText.substring(0, 200)}`);
  }

  const data = await resp.json();
  
  // 디버깅: 응답 구조 로깅
  console.log('OpenAI API response structure:', JSON.stringify({
    id: data.id,
    model: data.model,
    choices_length: data.choices?.length,
    first_choice: data.choices?.[0] ? {
      finish_reason: data.choices[0].finish_reason,
      message_role: data.choices[0].message?.role,
      content_length: data.choices[0].message?.content?.length
    } : null
  }, null, 2));
  
  // 응답에서 content 추출 (여러 형식 지원)
  let content = '';
  
  if (data.choices && data.choices.length > 0) {
    const choice = data.choices[0];
    // 일반적인 형식
    content = choice.message?.content || '';
    // 일부 모델은 text 필드 사용
    if (!content && choice.text) {
      content = choice.text;
    }
    // delta 형식 (스트리밍 응답의 일부)
    if (!content && choice.delta?.content) {
      content = choice.delta.content;
    }
  }
  
  // output 필드 확인 (일부 새 모델)
  if (!content && data.output) {
    content = typeof data.output === 'string' ? data.output : JSON.stringify(data.output);
  }
  
  if (!content) {
    console.error('OpenAI API 전체 응답:', JSON.stringify(data, null, 2));
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

