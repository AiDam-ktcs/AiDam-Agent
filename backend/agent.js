require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const agentsConfig = require('./config/agents.config');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

// 서버 포트
const PORT = process.env.PORT || 3000;

// Reports storage directory
const REPORTS_DIR = path.join(__dirname, 'reports');
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

/**
 * 에이전트 헬스체크 유틸리티
 */
async function checkAgentHealth(agentKey) {
  const agent = agentsConfig.getAgent(agentKey);
  if (!agent || !agent.enabled) {
    return { ok: false, status: 'disabled', agent: agent?.name || agentKey };
  }

  try {
    const url = agentsConfig.buildUrl(agentKey, 'health');
    const response = await fetch(url, { 
      timeout: 5000,
      signal: AbortSignal.timeout(5000)
    });
    
    if (response.ok) {
      const data = await response.json();
      return { ok: true, status: 'healthy', agent: agent.name, data };
    } else {
      return { ok: false, status: 'unhealthy', agent: agent.name };
    }
  } catch (error) {
    return { ok: false, status: 'unreachable', agent: agent.name, error: error.message };
  }
}

/**
 * Report Agent 호출 헬퍼
 */
async function callReportAgent(endpoint, body, isStreaming = false) {
  const agent = agentsConfig.getAgent('report');
  
  if (!agent.enabled) {
    throw new Error('Report Agent is disabled');
  }

  const url = agentsConfig.buildUrl('report', endpoint);
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeout: agent.timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Report Agent error (${response.status}): ${errorText}`);
    }

    return response;
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      throw new Error(
        `Report Agent에 연결할 수 없습니다 (${agent.url}). ` +
        `Report Agent가 실행 중인지 확인해주세요.`
      );
    }
    throw error;
  }
}

/**
 * Health Check - 전체 시스템 상태
 */
app.get('/health', async (req, res) => {
  const activeAgents = agentsConfig.getActiveAgents();
  const agentStatuses = {};

  // 각 활성 에이전트 헬스체크
  for (const agent of activeAgents) {
    agentStatuses[agent.key] = await checkAgentHealth(agent.key);
  }

  const allHealthy = Object.values(agentStatuses).every(s => s.ok);

  res.json({
    ok: allHealthy,
    mode: 'orchestrator',
    service: 'Main Backend (API Gateway)',
    timestamp: new Date().toISOString(),
    agents: agentStatuses,
    reports_dir: REPORTS_DIR
  });
});

/**
 * GET /models
 * 사용 가능한 모델 조회 (레거시 호환)
 */
app.get('/models', async (req, res) => {
  try {
    const reportAgent = agentsConfig.getAgent('report');
    if (!reportAgent.enabled) {
      return res.json({ models: [] });
    }

    // Report Agent의 LLM 설정 정보 반환
    const healthCheck = await checkAgentHealth('report');
    
    if (healthCheck.ok && healthCheck.data) {
      res.json({ 
        models: [{
          provider: healthCheck.data.provider,
          model: healthCheck.data.model,
          host: healthCheck.data.host
        }]
      });
    } else {
      res.json({ models: [] });
    }
  } catch (err) {
    console.error('Error fetching models:', err);
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

/**
 * POST /analyze
 * 대화 분석 (Report Agent에 위임)
 */
app.post('/analyze', async (req, res) => {
  try {
    const { messages, metadata } = req.body;
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    console.log(`[Orchestrator] Forwarding analysis request to Report Agent (${messages.length} messages)`);

    const response = await callReportAgent('analyze', { messages, metadata });
    const result = await response.json();

    res.json(result);
  } catch (err) {
    console.error('[Orchestrator] Analysis error:', err);
    res.status(500).json({ 
      error: err.message || 'Analysis failed',
      service: 'Main Backend'
    });
  }
});

/**
 * POST /generate-report
 * 보고서 생성 (Report Agent에 위임)
 */
app.post('/generate-report', async (req, res) => {
  try {
    const { analysis, format = 'markdown' } = req.body;
    
    if (!analysis) {
      return res.status(400).json({ error: 'analysis object is required' });
    }

    console.log('[Orchestrator] Forwarding report generation to Report Agent');

    const response = await callReportAgent('generate', { analysis, format });
    const result = await response.json();

    // 보고서를 파일로 저장
    if (result.success && result.report) {
      const reportData = {
        id: result.report.id,
        created_at: result.report.created_at,
        analysis,
        content: result.report.content,
        format
      };

      const reportPath = path.join(REPORTS_DIR, `${result.report.id}.json`);
      fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
      console.log(`[Orchestrator] Report saved: ${result.report.id}`);
    }

    res.json(result);
  } catch (err) {
    console.error('[Orchestrator] Report generation error:', err);
    res.status(500).json({ 
      error: err.message || 'Report generation failed',
      service: 'Main Backend'
    });
  }
});

/**
 * POST /process
 * 통합 프로세스: 분석 + 보고서 생성 (SSE 스트리밍)
 */
app.post('/process', async (req, res) => {
  try {
    const { messages, metadata } = req.body;
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    console.log(`[Orchestrator] Starting process for ${messages.length} messages`);

    // SSE 헤더 설정
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Report Agent 호출
    const response = await callReportAgent('process', { messages, metadata }, true);

    // Report Agent의 SSE 스트림을 클라이언트로 전달
    response.body.on('data', (chunk) => {
      const chunkStr = chunk.toString();
      
      // SSE 데이터 파싱 및 보고서 저장 처리
      if (chunkStr.includes('"step":5') || chunkStr.includes('"step": 5')) {
        try {
          const dataMatch = chunkStr.match(/data: ({.*})/);
          if (dataMatch) {
            const eventData = JSON.parse(dataMatch[1]);
            
            // 최종 결과에서 보고서 저장
            if (eventData.data && eventData.data.success && eventData.data.reportId) {
              const reportData = {
                id: eventData.data.reportId,
                created_at: eventData.data.created_at,
                analysis: eventData.data.analysis,
                content: eventData.data.report,
                format: 'markdown',
                messages: messages
              };

              const reportPath = path.join(REPORTS_DIR, `${eventData.data.reportId}.json`);
              fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
              console.log(`[Orchestrator] Report saved: ${eventData.data.reportId}`);
            }
          }
        } catch (parseError) {
          console.error('[Orchestrator] Error parsing SSE data:', parseError);
        }
      }

      // 클라이언트로 전달
      res.write(chunk);
    });

    response.body.on('end', () => {
      console.log('[Orchestrator] Process completed');
      res.end();
    });

    response.body.on('error', (err) => {
      console.error('[Orchestrator] Stream error:', err);
      res.end();
    });

  } catch (err) {
    console.error('[Orchestrator] Process error:', err);
    
    const errorMessage = err.message || '처리 중 오류가 발생했습니다.';
    
    res.write(`data: ${JSON.stringify({ 
      step: -1, 
      message: 'Error', 
      error: errorMessage,
      service: 'Main Backend'
    })}\n\n`);
    res.end();
  }
});

/**
 * GET /reports
 * 저장된 보고서 목록 조회
 */
app.get('/reports', (req, res) => {
  try {
    const files = fs.readdirSync(REPORTS_DIR);
    const reports = files
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, f), 'utf-8'));
          return {
            id: data.id,
            created_at: data.created_at,
            summary: data.analysis?.summary || 'No summary',
            topics: data.analysis?.main_topics || []
          };
        } catch (err) {
          console.error(`Error reading report ${f}:`, err);
          return null;
        }
      })
      .filter(r => r !== null)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ reports });
  } catch (err) {
    console.error('Error fetching reports:', err);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

/**
 * GET /reports/:id
 * 특정 보고서 조회
 */
app.get('/reports/:id', (req, res) => {
  try {
    const reportPath = path.join(REPORTS_DIR, `${req.params.id}.json`);
    
    if (!fs.existsSync(reportPath)) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const data = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    res.json({ success: true, report: data });
  } catch (err) {
    console.error('Error fetching report:', err);
    res.status(500).json({ error: 'Failed to fetch report' });
  }
});

/**
 * DELETE /reports/:id
 * 보고서 삭제
 */
app.delete('/reports/:id', (req, res) => {
  try {
    const reportPath = path.join(REPORTS_DIR, `${req.params.id}.json`);
    
    if (!fs.existsSync(reportPath)) {
      return res.status(404).json({ error: 'Report not found' });
    }

    fs.unlinkSync(reportPath);
    console.log(`[Orchestrator] Report deleted: ${req.params.id}`);
    res.json({ success: true, message: 'Report deleted' });
  } catch (err) {
    console.error('Error deleting report:', err);
    res.status(500).json({ error: 'Failed to delete report' });
  }
});

/**
 * POST /rag/chat
 * RAG 기반 상담 가이드 (RAG Agent에 위임)
 */
app.post('/rag/chat', async (req, res) => {
  try {
    const { message, history } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    // RAG Agent 헬스체크
    const ragAgentHealth = await checkAgentHealth('rag');
    
    if (!ragAgentHealth.ok) {
      return res.status(503).json({ 
        error: 'RAG Agent is not available',
        detail: 'RAG Agent가 실행 중이지 않습니다. 상담 가이드 기능을 사용할 수 없습니다.',
        service: 'Main Backend'
      });
    }

    console.log(`[Orchestrator] Forwarding chat request to RAG Agent: ${message}`);

    const ragAgent = agentsConfig.getAgent('rag');
    const url = agentsConfig.buildUrl('rag', 'chat');
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message,
        history: history || []
      }),
      timeout: ragAgent.timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`RAG Agent error (${response.status}): ${errorText}`);
    }

    const result = await response.json();
    
    console.log(`[Orchestrator] RAG Agent response received`);
    res.json(result);

  } catch (err) {
    console.error('[Orchestrator] RAG chat error:', err);
    
    if (err.code === 'ECONNREFUSED') {
      return res.status(503).json({ 
        error: 'RAG Agent에 연결할 수 없습니다.',
        detail: 'RAG Agent가 실행 중인지 확인해주세요 (포트 8000).',
        service: 'Main Backend'
      });
    }
    
    res.status(500).json({ 
      error: err.message || 'RAG chat failed',
      service: 'Main Backend'
    });
  }
});

/**
 * 404 핸들러
 */
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    service: 'Main Backend',
    available_endpoints: [
      'GET /health',
      'GET /models',
      'POST /analyze',
      'POST /generate-report',
      'POST /process',
      'GET /reports',
      'GET /reports/:id',
      'DELETE /reports/:id',
      'POST /rag/chat'
    ]
  });
});

/**
 * 에러 핸들러
 */
app.use((err, req, res, next) => {
  console.error('[Orchestrator] Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    service: 'Main Backend',
    message: err.message
  });
});

/**
 * 서버 시작
 */
app.listen(PORT, async () => {
  console.log('\n=== AiDam Main Backend (Orchestrator) Started ===');
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`Mode: Orchestrator (API Gateway)`);
  console.log(`Reports Directory: ${REPORTS_DIR}`);
  console.log('\n📡 Checking Agent Status...');
  
  const activeAgents = agentsConfig.getActiveAgents();
  
  for (const agent of activeAgents) {
    const health = await checkAgentHealth(agent.key);
    const statusIcon = health.ok ? '✅' : '❌';
    console.log(`${statusIcon} ${agent.name} (${agent.url}): ${health.status}`);
  }
  
  console.log('\n📋 Available Endpoints:');
  console.log('  - GET  /health           (System health check)');
  console.log('  - GET  /models           (Available LLM models)');
  console.log('  - POST /analyze          (Analyze conversation)');
  console.log('  - POST /generate-report  (Generate report)');
  console.log('  - POST /process          (Full analysis + report)');
  console.log('  - GET  /reports          (List all reports)');
  console.log('  - GET  /reports/:id      (Get specific report)');
  console.log('  - DELETE /reports/:id    (Delete report)');
  console.log('  - POST /rag/chat         (RAG-based guide)');
  console.log('================================================\n');
});

module.exports = app;
