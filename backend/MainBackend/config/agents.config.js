/**
 * 에이전트 설정 파일
 * 모든 마이크로서비스 에이전트의 중앙 설정
 */

module.exports = {
  agents: {
    report: {
      name: 'Report Agent',
      url: process.env.REPORT_AGENT_URL || 'http://localhost:8001',
      enabled: process.env.REPORT_AGENT_ENABLED !== 'false',
      description: '최종 정리 에이전트 (STT/RAG 후 실행)',
      timeout: 60000, // 60초
      endpoints: {
        health: '/health',
        analyze: '/analyze',
        generate: '/generate',
        process: '/process'
      }
    },
    stt: {
      name: 'STT Module (Temp)',
      url: process.env.STT_AGENT_URL || 'http://localhost:8080',
      enabled: true,
      description: '실시간 음성→텍스트 변환 (Mock Server)',
      timeout: 5000,
      endpoints: {
        health: '/health',
        transcribe: '/transcribe',
        stream: '/stream'
      }
    },
    rag: {
      name: 'RAG Agent',
      url: process.env.RAG_AGENT_URL || 'http://localhost:8000',
      enabled: process.env.RAG_AGENT_ENABLED !== 'false',
      description: 'RAG 기반 상담 가이드 제공 (FastAPI)',
      timeout: 30000,
      endpoints: {
        health: '/',
        chat: '/chat',
        search: '/search'
      }
    },
    upsell: {
      name: 'Upsell Agent',
      url: process.env.UPSELL_AGENT_URL || 'http://localhost:8008',
      enabled: process.env.UPSELL_AGENT_ENABLED !== 'false',
      description: '업셀링 가능성 판단 및 고객 의중 분석 (FastAPI)',
      timeout: 30000,
      endpoints: {
        health: '/health',
        analyze: '/analyze',
        analyzeQuick: '/analyze/quick',
        intentOnly: '/intent-only'
      }
    }
  },

  /**
   * 활성화된 에이전트 목록 반환
   */
  getActiveAgents() {
    return Object.entries(this.agents)
      .filter(([key, agent]) => agent.enabled)
      .map(([key, agent]) => ({ key, ...agent }));
  },

  /**
   * 특정 에이전트 설정 반환
   */
  getAgent(agentKey) {
    return this.agents[agentKey] || null;
  },

  /**
   * 에이전트 URL 구성
   */
  buildUrl(agentKey, endpoint) {
    const agent = this.getAgent(agentKey);
    if (!agent) {
      throw new Error(`Unknown agent: ${agentKey}`);
    }

    const endpointPath = agent.endpoints[endpoint];
    if (!endpointPath) {
      throw new Error(`Unknown endpoint: ${endpoint} for agent: ${agentKey}`);
    }

    return `${agent.url}${endpointPath}`;
  }
};


