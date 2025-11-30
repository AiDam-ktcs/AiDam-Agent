const { callLLM } = require('../../../shared/llm-client');
const { formatConversation, calculateStatistics, extractJSON } = require('../../../shared/schemas');

/**
 * 대화 분석 서비스
 * LLM을 사용하여 대화를 분석하고 구조화된 결과를 반환
 */

/**
 * 대화 분석 프롬프트 생성
 */
function createAnalysisPrompt(conversationText, statistics) {
  return `다음 대화를 분석하고 상세한 분석 결과를 JSON 형식으로 제공하세요.

대화 내용:
${conversationText}

다음 JSON 구조로 분석 결과를 작성하세요 (모든 텍스트는 한글로):
{
  "summary": "전체 대화에 대한 간략한 요약 (2-3문장)",
  "main_topics": ["주제1", "주제2", ...],
  "key_points": ["핵심 포인트1", "핵심 포인트2", ...],
  "sentiment": "긍정적/부정적/중립적/복합적",
  "participant_roles": {
    "user": "사용자의 행동과 의도 설명",
    "assistant": "상담사의 행동과 응답 방식 설명"
  },
  "conversation_flow": "대화가 어떻게 전개되었는지 설명",
  "insights": ["통찰1", "통찰2", ...],
  "statistics": {
    "total_messages": ${statistics.total_messages},
    "user_messages": ${statistics.user_messages},
    "assistant_messages": ${statistics.assistant_messages},
    "average_message_length": ${statistics.average_message_length}
  }
}

반드시 유효한 JSON만 응답하고, 추가 텍스트는 포함하지 마세요.`;
}

/**
 * 폴백 분석 생성 (LLM 실패 시)
 */
function createFallbackAnalysis(messages, rawResponse = '') {
  const statistics = calculateStatistics(messages);
  
  return {
    summary: rawResponse 
      ? rawResponse.substring(0, 200) 
      : '대화 분석이 완료되었습니다.',
    main_topics: ['일반 대화'],
    key_points: ['분석 완료'],
    sentiment: '중립적',
    participant_roles: {
      user: '사용자',
      assistant: '상담사'
    },
    conversation_flow: '대화가 진행되었습니다.',
    insights: ['자세한 내용은 원본 대화를 참고하세요.'],
    statistics
  };
}

/**
 * 대화 분석 수행
 * @param {Array} messages - 분석할 메시지 배열
 * @param {Object} metadata - 추가 메타데이터
 * @returns {Promise<Object>} 분석 결과
 */
async function analyzeConversation(messages, metadata = {}) {
  try {
    console.log(`[Analyzer] Analyzing conversation with ${messages.length} messages...`);

    // 대화 포맷팅
    const conversationText = formatConversation(messages);
    
    // 통계 계산
    const statistics = calculateStatistics(messages);
    
    // 분석 프롬프트 생성
    const analysisPrompt = createAnalysisPrompt(conversationText, statistics);
    
    // LLM 호출
    console.log('[Analyzer] Calling LLM for analysis...');
    const analysisResult = await callLLM(analysisPrompt);
    
    // JSON 응답 파싱
    let analysis;
    try {
      analysis = extractJSON(analysisResult);
      console.log('[Analyzer] Successfully parsed LLM response');
    } catch (parseError) {
      console.error('[Analyzer] Failed to parse LLM response as JSON:', parseError.message);
      console.log('[Analyzer] Using fallback analysis');
      analysis = createFallbackAnalysis(messages, analysisResult);
    }
    
    // 메타데이터 추가
    analysis.metadata = {
      analyzed_at: new Date().toISOString(),
      ...metadata
    };
    
    console.log('[Analyzer] Analysis completed successfully');
    return analysis;
    
  } catch (error) {
    console.error('[Analyzer] Analysis error:', error);
    
    // 에러 발생 시 폴백 분석 반환
    console.log('[Analyzer] Returning fallback analysis due to error');
    const fallbackAnalysis = createFallbackAnalysis(messages);
    fallbackAnalysis.metadata = {
      analyzed_at: new Date().toISOString(),
      error: error.message,
      fallback: true,
      ...metadata
    };
    
    return fallbackAnalysis;
  }
}

/**
 * 간단한 감정 분석 (폴백용)
 */
function simplesentimentAnalysis(messages) {
  const positiveWords = ['좋', '감사', '훌륭', '만족', '최고', '완벽'];
  const negativeWords = ['나쁘', '불만', '실망', '최악', '화', '짜증'];
  
  const allText = messages.map(m => m.content).join(' ').toLowerCase();
  
  const positiveCount = positiveWords.reduce(
    (count, word) => count + (allText.includes(word) ? 1 : 0), 0
  );
  const negativeCount = negativeWords.reduce(
    (count, word) => count + (allText.includes(word) ? 1 : 0), 0
  );
  
  if (positiveCount > negativeCount) return '긍정적';
  if (negativeCount > positiveCount) return '부정적';
  return '중립적';
}

module.exports = {
  analyzeConversation,
  createAnalysisPrompt,
  createFallbackAnalysis,
  simplesentimentAnalysis
};


