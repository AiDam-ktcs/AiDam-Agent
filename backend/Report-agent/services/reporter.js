const { callLLM } = require('./llm-client');

/**
 * 보고서 생성 서비스
 * 분석 결과를 바탕으로 마크다운 보고서 생성
 */

/**
 * 보고서 생성 프롬프트 생성
 */
/**
 * 보고서 생성 프롬프트 생성
 */
function createReportPrompt(analysis, customerInfo) {
  let customerSection = "";
  if (customerInfo) {
    customerSection = `
# 고객 정보
- **이름**: ${customerInfo['이름']}
- **전화번호**: ${customerInfo['번호']}
- **요금제**: ${customerInfo['요금제']}
- **나이**: ${customerInfo['나이']}
- **데이터 사용량**: 전월 ${customerInfo['전월 데이터']}, 현월 ${customerInfo['현월 데이터']}
`;
  }

  return `대화 분석 데이터를 기반으로 전문적이고 포괄적인 보고서를 작성하세요.

${customerSection ? "먼저 아래 고객 정보를 보고서 최상단에 별도 섹션으로 그대로 포함시키세요.\n" + customerSection : ""}

분석 데이터:
${JSON.stringify(analysis, null, 2)}

다음 섹션으로 구성된 상세한 보고서를 한글 Markdown 형식으로 작성하세요:
1. ${customerInfo ? '고객 정보 (위의 내용을 포함)' : '고객 정보 (정보 없음)'}
2. 요약
3. 대화 개요
4. 주요 주제 및 테마
5. 상세 분석
6. 참여자 행동 분석
7. 인사이트 및 관찰 사항
8. 통계
9. 권장 사항 (현재 요금제와 사용량을 고려하여 제안)

보고서는 명확하고 전문적이며 실용적이어야 합니다. 제목. 목록, 표, 강조 등 적절한 Markdown 형식을 사용하세요.`;
}

/**
 * 폴백 보고서 생성 (LLM 실패 시)
 */
function createFallbackReport(analysis, customerInfo) {
  const timestamp = new Date().toLocaleString('ko-KR');

  let customerInfoBlock = "";
  if (customerInfo) {
    customerInfoBlock = `
## 👤 고객 정보
- **이름**: ${customerInfo['이름']}
- **요금제**: ${customerInfo['요금제']}
- **데이터 사용**: 전월 ${customerInfo['전월 데이터']} / 현월 ${customerInfo['현월 데이터']}
`;
  }

  return `# 대화 분석 보고서

## 📋 요약

${analysis.summary || '대화 분석이 완료되었습니다.'}

${customerInfoBlock}

## 📊 통계

- **전체 메시지**: ${analysis.statistics?.total_messages || 0}개
- **사용자 메시지**: ${analysis.statistics?.user_messages || 0}개
- **상담사 메시지**: ${analysis.statistics?.assistant_messages || 0}개
- **평균 메시지 길이**: ${analysis.statistics?.average_message_length || 0}자

## 🎯 주요 주제

${(analysis.main_topics || []).map(topic => `- ${topic}`).join('\n')}

## 💡 핵심 포인트

${(analysis.key_points || []).map(point => `- ${point}`).join('\n')}

## 😊 감정 분석

**전체 감정**: ${analysis.sentiment || '중립적'}

## 🔍 인사이트

${(analysis.insights || []).map(insight => `- ${insight}`).join('\n')}

## 👥 참여자 분석

### 사용자
${analysis.participant_roles?.user || '분석 정보 없음'}

### 상담사
${analysis.participant_roles?.assistant || '분석 정보 없음'}

## 📝 대화 흐름

${analysis.conversation_flow || '대화가 진행되었습니다.'}

---

*보고서 생성 시간: ${timestamp}*
`;
}

/**
 * 보고서 생성
 * @param {Object} analysis - 분석 결과
 * @param {string} format - 보고서 형식 (현재는 markdown만 지원)
 * @param {Object} customerInfo - 고객 정보 (Optional)
 * @returns {Promise<string>} 생성된 보고서
 */
async function generateReport(analysis, format = 'markdown', customerInfo = null) {
  try {
    console.log('[Reporter] Generating report...');

    if (format !== 'markdown') {
      console.warn(`[Reporter] Unsupported format: ${format}. Using markdown.`);
    }

    // 보고서 프롬프트 생성
    const reportPrompt = createReportPrompt(analysis, customerInfo);

    // LLM 호출
    console.log('[Reporter] Calling LLM for report generation...');
    const reportContent = await callLLM(reportPrompt);

    console.log('[Reporter] Report generated successfully');
    return reportContent;

  } catch (error) {
    console.error('[Reporter] Report generation error:', error);

    // 에러 발생 시 폴백 보고서 반환
    console.log('[Reporter] Using fallback report due to error');
    return createFallbackReport(analysis, customerInfo);
  }
}

/**
 * 보고서 메타데이터 생성
 */
function createReportMetadata(analysis, reportContent) {
  return {
    id: `report_${Date.now()}`,
    created_at: new Date().toISOString(),
    analysis,
    content: reportContent,
    format: 'markdown',
    word_count: reportContent.split(/\s+/).length,
    char_count: reportContent.length,
    sections: countSections(reportContent)
  };
}

/**
 * 보고서 섹션 수 계산
 */
function countSections(reportContent) {
  const headings = reportContent.match(/^#{1,3}\s+.+$/gm);
  return headings ? headings.length : 0;
}

/**
 * 간단한 보고서 생성 (빠른 요약용)
 */
function generateQuickReport(analysis) {
  return createFallbackReport(analysis, null);
}

module.exports = {
  generateReport,
  createReportPrompt,
  createFallbackReport,
  createReportMetadata,
  generateQuickReport
};


