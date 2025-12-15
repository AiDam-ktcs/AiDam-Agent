/**
 * API 스키마 정의
 * 에이전트 간 통신을 위한 공통 데이터 구조
 */

/**
 * 대화 메시지 검증
 */
function validateMessages(messages) {
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages array is required and must not be empty');
  }

  for (const msg of messages) {
    if (!msg.role || !msg.content) {
      throw new Error('Each message must have role and content');
    }
    if (!['user', 'assistant', 'system'].includes(msg.role)) {
      throw new Error(`Invalid role: ${msg.role}. Must be user, assistant, or system`);
    }
  }

  return true;
}

/**
 * 분석 요청 스키마
 */
const AnalysisRequestSchema = {
  messages: 'array',  // required
  metadata: 'object'  // optional
};

/**
 * 분석 응답 스키마
 */
const AnalysisResponseSchema = {
  success: 'boolean',
  analysis: {
    summary: 'string',
    main_topics: 'array',
    key_points: 'array',
    sentiment: 'string',
    participant_roles: 'object',
    conversation_flow: 'string',
    insights: 'array',
    statistics: {
      total_messages: 'number',
      user_messages: 'number',
      assistant_messages: 'number',
      average_message_length: 'number'
    },
    metadata: 'object'
  }
};

/**
 * 보고서 생성 요청 스키마
 */
const ReportRequestSchema = {
  analysis: 'object',  // required
  format: 'string'     // optional, default: 'markdown'
};

/**
 * 보고서 응답 스키마
 */
const ReportResponseSchema = {
  success: 'boolean',
  report: {
    id: 'string',
    content: 'string',
    created_at: 'string'
  }
};

/**
 * 통합 프로세스 요청 스키마
 */
const ProcessRequestSchema = {
  messages: 'array',
  metadata: 'object'
};

/**
 * 에이전트 헬스체크 응답 스키마
 */
const HealthCheckSchema = {
  ok: 'boolean',
  service: 'string',
  provider: 'string',
  model: 'string',
  host: 'string',
  timestamp: 'string'
};

/**
 * 에러 응답 스키마
 */
const ErrorResponseSchema = {
  error: 'string',
  code: 'string',
  service: 'string',
  details: 'object'
};

/**
 * 대화를 포맷팅 (공통 유틸리티)
 */
function formatConversation(messages) {
  return messages.map((m, idx) => {
    return `[${idx + 1}] ${m.role.toUpperCase()}: ${m.content}`;
  }).join('\n\n');
}

/**
 * 통계 계산 (공통 유틸리티)
 */
function calculateStatistics(messages) {
  const userMessages = messages.filter(m => m.role === 'user');
  const assistantMessages = messages.filter(m => m.role === 'assistant');
  const totalLength = messages.reduce((sum, m) => sum + m.content.length, 0);

  return {
    total_messages: messages.length,
    user_messages: userMessages.length,
    assistant_messages: assistantMessages.length,
    average_message_length: messages.length > 0 
      ? Math.round(totalLength / messages.length) 
      : 0
  };
}

/**
 * JSON 추출 (LLM 응답에서)
 */
function extractJSON(text) {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  throw new Error('No valid JSON found in response');
}

module.exports = {
  // 스키마
  AnalysisRequestSchema,
  AnalysisResponseSchema,
  ReportRequestSchema,
  ReportResponseSchema,
  ProcessRequestSchema,
  HealthCheckSchema,
  ErrorResponseSchema,
  
  // 유틸리티 함수
  validateMessages,
  formatConversation,
  calculateStatistics,
  extractJSON
};

