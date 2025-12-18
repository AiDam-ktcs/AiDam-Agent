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

// --- Data Management ---
const DATA_DIR = path.join(__dirname, 'docs');
const CONSULTATIONS_DIR = path.join(DATA_DIR, 'consultations');
if (!fs.existsSync(CONSULTATIONS_DIR)) {
  fs.mkdirSync(CONSULTATIONS_DIR, { recursive: true });
}

let CUSTOMERS = [];
let PRICING_PLANS = {};
let ACTIVE_CALL = null; // { customer: {}, startTime: ... }

// Save Consultation Helper
function saveConsultation(call) {
  if (!call || !call.callId) return;
  try {
    const filePath = path.join(CONSULTATIONS_DIR, `${call.callId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(call, null, 2));
    console.log(`[System] Saved consultation: ${call.callId}`);
  } catch (err) {
    console.error(`[System] Failed to save consultation ${call.callId}:`, err);
  }
}

// Load Customer Data (CSV)
function loadCustomers() {
  try {
    const csvPath = path.join(DATA_DIR, 'customer_data.csv');
    if (fs.existsSync(csvPath)) {
      const data = fs.readFileSync(csvPath, 'utf-8');
      const lines = data.trim().split('\n');
      const headers = lines[0].split(',').map(h => h.trim());

      CUSTOMERS = lines.slice(1).map(line => {
        const values = line.split(',');
        const customer = {};
        headers.forEach((header, index) => {
          customer[header] = values[index]?.trim();
        });
        return customer;
      });
      console.log(`[System] Loaded ${CUSTOMERS.length} customers.`);
    } else {
      console.warn('[System] customer_data.csv not found.');
    }
  } catch (err) {
    console.error('[System] Failed to load customers:', err);
  }
}

// Load Pricing Plans (JSON)
function loadPricingPlans() {
  try {
    const jsonPath = path.join(DATA_DIR, 'pricing_plan.json');
    if (fs.existsSync(jsonPath)) {
      PRICING_PLANS = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      console.log('[System] Loaded pricing plans.');
    } else {
      console.warn('[System] pricing_plan.json not found.');
    }
  } catch (err) {
    console.error('[System] Failed to load pricing plans:', err);
  }
}

// Initial Load
loadCustomers();
loadPricingPlans();

// --- Customer & Call Endpoints ---

/**
 * GET /customers
 * Search customers by name or phone
 */
app.get('/customers', (req, res) => {
  const { query } = req.query;
  if (!query) {
    return res.json({ customers: CUSTOMERS.slice(0, 50) }); // Limit to 50 for safety
  }

  const lowerQuery = query.toLowerCase();
  const results = CUSTOMERS.filter(c =>
    c['이름']?.toLowerCase().includes(lowerQuery) ||
    c['번호']?.includes(lowerQuery)
  );

  res.json({ customers: results });
});

/**
 * POST /customers
 * Update customer data (In-Memory Only for now)
 */
app.post('/customers', (req, res) => {
  try {
    const { phone, updates } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number required' });

    const index = CUSTOMERS.findIndex(c => c['번호'] === phone);
    if (index === -1) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Update fields
    CUSTOMERS[index] = { ...CUSTOMERS[index], ...updates };

    // Update active call if it matches
    if (ACTIVE_CALL && ACTIVE_CALL.customer['번호'] === phone) {
      ACTIVE_CALL.customer = CUSTOMERS[index];
    }

    res.json({ success: true, customer: CUSTOMERS[index] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /pricing
 * Get all pricing plans
 */
app.get('/pricing', (req, res) => {
  res.json(PRICING_PLANS);
});

/**
 * POST /api/stt/call-start
 * Start Incoming Call (STT Module Trigger)
 */
app.post('/api/stt/call-start', (req, res) => {
  const { callId, phoneNumber, timestamp } = req.body;
  if (!phoneNumber) return res.status(400).json({ error: 'phoneNumber required' });

  // Find Customer
  const customer = CUSTOMERS.find(c => c['번호'] === phoneNumber);

  ACTIVE_CALL = {
    callId: callId || `call-${Date.now()}`,
    status: 'active', // 바로 active로 설정 (STT가 시작되었으므로)
    customer: customer || { '이름': 'Unknown', '번호': phoneNumber },
    startTime: timestamp || new Date().toISOString(),
    startTime: timestamp || new Date().toISOString(),
    messages: [], // 대화 내역 저장소 초기화
    upsellAnalysis: null, // Upsell 분석 결과 (Latest)
    upsellAnalysisHistory: [], // [NEW] 메세지별 분석 이력
    ragResults: [] // RAG 자동 생성 결과
  };

  saveConsultation(ACTIVE_CALL);

  console.log(`[STT] Call Started: ${phoneNumber} (${ACTIVE_CALL.customer['이름']})`);
  res.json({ success: true, call: ACTIVE_CALL });
});

/**
 * POST /api/stt/line
 * Receive STT Line
 */
app.post('/api/stt/line', async (req, res) => {
  const { callId, speaker, text, keywords } = req.body;

  if (!ACTIVE_CALL) {
    return res.status(400).json({ error: 'No active call' });
  }

  // Optional: Check callId match
  // if (callId && ACTIVE_CALL.callId !== callId) ...

  const newMessage = {
    role: speaker === 'customer' ? 'user' : 'assistant',
    content: text,
    keywords: keywords || [],
    timestamp: new Date().toISOString(),
    messageId: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` // [NEW] 메시지 ID 생성
  };

  ACTIVE_CALL.messages.push(newMessage);
  saveConsultation(ACTIVE_CALL); // 매 줄마다 저장 (실시간성 보장 위해)

  console.log(`[STT] Line Received (${speaker}): ${text}`);

  // Async: Forward to Upsell Agent (Fire-and-Forget)
  // 분석이 필요한지는 Upsell Agent가 스스로 판단하도록 함
  (async () => {
    try {
      // 현재 활성 콜의 메타데이터(고객정보 등) 생성
      const payload = {
        message: newMessage,
        recent_history: ACTIVE_CALL.messages.slice(-10), // 최근 10개 메시지 포함
        active_call_context: {
          callId: ACTIVE_CALL.callId,
          customer: ACTIVE_CALL.customer,
          current_plan: ACTIVE_CALL.customer['요금제'] || 'Unknown' // 단순화된 정보
        },
        history_length: ACTIVE_CALL.messages.length
      };

      const upsellAgent = agentsConfig.getAgent('upsell');
      if (upsellAgent && upsellAgent.enabled) {
        const url = agentsConfig.buildUrl('upsell', 'onMessage');

        // Non-blocking fetch
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          timeout: 5000 // 짧은 타임아웃
        }).catch(err => console.error(`[System] Failed to forward to Upsell Agent: ${err.message}`));
      }

      // RAG Agent로도 동일한 데이터 전송
      const ragAgent = agentsConfig.getAgent('rag');
      console.log(`[DEBUG] RAG Agent config:`, ragAgent ? { enabled: ragAgent.enabled, url: ragAgent.url } : 'NOT FOUND');
      if (ragAgent && ragAgent.enabled) {
        const url = agentsConfig.buildUrl('rag', 'onMessage');
        console.log(`[DEBUG] Sending to RAG Agent: ${url}`);
        console.log(`[DEBUG] Payload role: ${payload.message?.role}, content: ${payload.message?.content?.substring(0, 30)}...`);
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          timeout: 5000
        })
          .then(res => res.json())
          .then(data => console.log(`[DEBUG] RAG Agent response:`, data))
          .catch(err => console.error(`[System] Failed to forward to RAG Agent: ${err.message}`));
      } else {
        console.log(`[DEBUG] RAG Agent skipped: agent=${!!ragAgent}, enabled=${ragAgent?.enabled}`);
      }
    } catch (e) {
      console.error(`[System] Error triggering upsell logic: ${e.message}`);
    }
  })();

  res.json({ success: true });
});

// Legacy support for existing test (if any)
app.post('/stt/incoming-call', (req, res) => {
  req.body.phoneNumber = req.body.phone_number;
  const { phone_number } = req.body;
  if (!phone_number) return res.status(400).json({ error: 'phone_number required' });

  const customer = CUSTOMERS.find(c => c['번호'] === phone_number);

  ACTIVE_CALL = {
    callId: `sim-${Date.now()}`,
    status: 'active',
    customer: customer || { '이름': 'Unknown', '번호': phone_number },
    startTime: new Date().toISOString(),
    messages: [],
    ragResults: [] // RAG 자동 생성 결과
  };

  saveConsultation(ACTIVE_CALL);

  console.log(`[Sim] Call active: ${phone_number}`);
  res.json({ success: true, call: ACTIVE_CALL });
});

/**
 * POST /call/outbound
 * Initiate Outbound Call
 */
app.post('/call/outbound', (req, res) => {
  const { phone_number } = req.body;
  if (!phone_number) return res.status(400).json({ error: 'phone_number required' });

  const customer = CUSTOMERS.find(c => c['번호'] === phone_number);

  ACTIVE_CALL = {
    callId: `out-${Date.now()}`,
    status: 'dialing',
    customer: customer || { '이름': 'Unknown', '번호': phone_number },
    startTime: new Date().toISOString(),
    messages: [],
    ragResults: [] // RAG 자동 생성 결과
  };

  saveConsultation(ACTIVE_CALL);

  console.log(`[Call] Dialing to ${phone_number}...`);
  res.json({ success: true, call: ACTIVE_CALL });
});

/**
 * GET /active-call
 * Get current active call status
 */
app.get('/active-call', (req, res) => {
  res.json({
    active: !!ACTIVE_CALL,
    call: ACTIVE_CALL ? {
      ...ACTIVE_CALL,
      // Agent 결과 포함
      ragResults: ACTIVE_CALL.ragResults || [],
      upsellAnalysisHistory: ACTIVE_CALL.upsellAnalysisHistory || [], // [NEW]
      latestIntent: ACTIVE_CALL.latestIntent || null
    } : null
  });
});

/**
 * Background Task: Trigger Report Generation
 */
async function triggerReportGeneration(callData) {
  if (!callData || !callData.messages || callData.messages.length === 0) {
    console.log('[System] Skipping report generation: No messages.');
    return;
  }

  console.log(`[System] Triggering background report generation for call ${callData.callId}...`);

  try {
    // 1. Analyze
    console.log(`[System] Requesting analysis for ${callData.callId}...`);
    const analysisResp = await callReportAgent('analyze', {
      messages: callData.messages,
      metadata: {
        callId: callData.callId,
        customer: callData.customer,
        startTime: callData.startTime,
        endTime: callData.endTime
      }
    });
    const analysisResult = await analysisResp.json();

    if (!analysisResult.success || !analysisResult.analysis) {
      throw new Error('Analysis failed or returned empty result');
    }

    // 2. Generate Report
    console.log(`[System] Requesting report generation for ${callData.callId}...`);
    const generateResp = await callReportAgent('generate', {
      analysis: analysisResult.analysis,
      format: 'markdown'
    });
    const generateResult = await generateResp.json();

    if (!generateResult.success || !generateResult.report) {
      throw new Error('Report generation failed');
    }

    // 3. Save Report
    const report = generateResult.report;
    const reportData = {
      id: report.id,
      callId: callData.callId,
      created_at: report.created_at,
      customer_phone: callData.customer['번호'],
      customer_name: callData.customer['이름'],
      analysis: analysisResult.analysis,
      content: report.content,
      format: 'markdown',
      regeneration_count: metadata?.regeneration_count || 0,
      original_report_id: metadata?.original_report_id || null
    };

    const reportPath = path.join(REPORTS_DIR, `${report.id}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
    console.log(`[System] Report generated and saved: ${report.id} (Call: ${callData.callId})`);

    // 4. Update Consultation Record with Report ID
    callData.reportId = report.id;
    saveConsultation(callData);

  } catch (err) {
    console.error(`[System] Report generation failed for call ${callData.callId}:`, err);
  }
}

/**
 * POST /item/call/end
 * End current call
 */
app.post('/call/end', (req, res) => {
  if (ACTIVE_CALL) {
    console.log(`[Call] Ended call with ${ACTIVE_CALL.customer['번호']}`);
    ACTIVE_CALL.status = 'completed';
    ACTIVE_CALL.endTime = new Date().toISOString();

    // Save final state
    saveConsultation(ACTIVE_CALL);

    // Trigger Report Generation (Background) - REMOVED per user request
    // triggerReportGeneration(ACTIVE_CALL);

    ACTIVE_CALL = null;
  }
  res.json({ success: true });
});

// 서버 포트
const PORT = process.env.PORT || 3000;

// Agent 자동 호출 설정
const AUTO_RAG_ENABLED = process.env.AUTO_RAG_ENABLED !== 'false'; // 기본 활성화
const AUTO_UPSELL_ENABLED = process.env.AUTO_UPSELL_ENABLED !== 'false';
const UPSELL_TRIGGER_INTERVAL = parseInt(process.env.UPSELL_TRIGGER_INTERVAL || '3'); // N개 메시지마다

// Reports storage directory
const REPORTS_DIR = path.join(__dirname, 'reports');
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

/**
 * 키워드 기반 RAG 자동 검색
 */
async function autoSearchRAG(keywords) {
  if (!AUTO_RAG_ENABLED || !keywords || keywords.length === 0) {
    return null;
  }

  const ragAgent = agentsConfig.getAgent('rag');
  if (!ragAgent || !ragAgent.enabled) {
    return null;
  }

  try {
    // 키워드를 쿼리로 결합
    const query = keywords.join(' ');
    const url = agentsConfig.buildUrl('rag', 'search');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, k: 3 }),
      timeout: 5000
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`[AutoRAG] Found ${result.sources?.length || 0} relevant manual sections for: ${query}`);
      return result.sources;
    }
  } catch (error) {
    console.error(`[AutoRAG] Error: ${error.message}`);
  }

  return null;
}

/**
 * 대화 기반 자동 업셀링 분석
 */
async function autoAnalyzeIntent(messages, customerInfo) {
  if (!AUTO_UPSELL_ENABLED || !messages || messages.length === 0) {
    return null;
  }

  // N개 메시지마다만 실행 (과부하 방지)
  if (messages.length % UPSELL_TRIGGER_INTERVAL !== 0) {
    return null;
  }

  const upsellAgent = agentsConfig.getAgent('upsell');
  if (!upsellAgent || !upsellAgent.enabled) {
    return null;
  }

  try {
    const url = agentsConfig.buildUrl('upsell', 'intentOnly');

    // 최근 10개 메시지만 전송 (성능 최적화)
    const recentMessages = messages.slice(-10);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_history: recentMessages,
        current_plan_name: customerInfo?.['요금제'] || 'Unknown',
        current_plan_fee: 35000 // TODO: 실제 요금 매핑
      }),
      timeout: 8000
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`[AutoUpsell] Intent: ${result.customer_intent} (confidence: ${result.intent_confidence})`);
      return result;
    }
  } catch (error) {
    console.error(`[AutoUpsell] Error: ${error.message}`);
  }

  return null;
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
        format,
        regeneration_count: 0
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
              // Extract customer info from active call if available
              const customerName = ACTIVE_CALL?.customer?.['이름'] || eventData.data.customer_name || 'Unknown';
              const customerPhone = ACTIVE_CALL?.customer?.['번호'] || eventData.data.customer_phone || 'Unknown';

              const reportData = {
                id: eventData.data.reportId,
                created_at: eventData.data.created_at,
                analysis: eventData.data.analysis,
                content: eventData.data.report,
                format: 'markdown',
                messages: messages,
                customer_phone: customerPhone,
                customer_name: customerName,
                ui_snapshot: metadata?.ui_snapshot || null, // Save UI Snapshot
                regeneration_count: metadata?.regeneration_count || 0,
                original_report_id: metadata?.original_report_id || null
              };

              const reportPath = path.join(REPORTS_DIR, `${eventData.data.reportId}.json`);
              fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
              console.log(`[Orchestrator] Report saved: ${eventData.data.reportId} (Customer: ${eventData.data.customer_phone || 'None'})`);
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
 * 저장된 보고서 목록 조회 (Optional: ?phone=... for filtering)
 */
app.get('/reports', (req, res) => {
  try {
    const { phone } = req.query;
    const files = fs.readdirSync(REPORTS_DIR);
    const reports = files
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, f), 'utf-8'));

          // Filter by phone if provided
          if (phone && data.customer_phone !== phone) {
            return null;
          }

          return {
            id: data.id,
            created_at: data.created_at,
            summary: data.analysis?.summary || 'No summary',
            topics: data.analysis?.main_topics || [],
            customer_phone: data.customer_phone,
            customer_name: data.customer_name,
            regeneration_count: data.regeneration_count || 0
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
    const { message, history, force_generate } = req.body;

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

    console.log(`[Orchestrator] Forwarding chat request to RAG Agent: ${message} (force: ${force_generate || false})`);

    const ragAgent = agentsConfig.getAgent('rag');
    const url = agentsConfig.buildUrl('rag', 'chat');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message,
        history: history || [],
        force_generate: force_generate || false
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
 * POST /rag/search
 * RAG 검색 전용 (빠른 매뉴얼 검색, LLM 답변 생성 없음)
 */
app.post('/rag/search', async (req, res) => {
  try {
    const { query, k = 3 } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }

    // RAG Agent 헬스체크
    const ragAgentHealth = await checkAgentHealth('rag');

    if (!ragAgentHealth.ok) {
      return res.status(503).json({
        error: 'RAG Agent is not available',
        detail: 'RAG Agent가 실행 중이지 않습니다.',
        service: 'Main Backend'
      });
    }

    console.log(`[Orchestrator] Forwarding search request to RAG Agent: ${query}`);

    const ragAgent = agentsConfig.getAgent('rag');
    const url = agentsConfig.buildUrl('rag', 'search');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: query,
        k: k
      }),
      timeout: ragAgent.timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`RAG Agent error (${response.status}): ${errorText}`);
    }

    const result = await response.json();

    console.log(`[Orchestrator] RAG Agent search response received`);
    res.json(result);

  } catch (err) {
    console.error('[Orchestrator] RAG search error:', err);

    if (err.code === 'ECONNREFUSED') {
      return res.status(503).json({
        error: 'RAG Agent에 연결할 수 없습니다.',
        detail: 'RAG Agent가 실행 중인지 확인해주세요 (포트 8000).',
        service: 'Main Backend'
      });
    }

    res.status(500).json({
      error: err.message || 'RAG search failed',
      service: 'Main Backend'
    });
  }
});

/**
 * POST /upsell/analyze
 * 업셀링 가능성 분석 (Upsell Agent에 위임)
 */
app.post('/upsell/analyze', async (req, res) => {
  try {
    const { conversation_history, current_plan, rag_suggestion, customer_info } = req.body;

    if (!conversation_history || !Array.isArray(conversation_history)) {
      return res.status(400).json({ error: 'conversation_history array is required' });
    }

    if (!current_plan) {
      return res.status(400).json({ error: 'current_plan is required' });
    }

    // Upsell Agent 헬스체크
    const upsellAgentHealth = await checkAgentHealth('upsell');

    if (!upsellAgentHealth.ok) {
      return res.status(503).json({
        error: 'Upsell Agent is not available',
        detail: 'Upsell Agent가 실행 중이지 않습니다. 업셀링 분석 기능을 사용할 수 없습니다.',
        service: 'Main Backend'
      });
    }

    console.log(`[Orchestrator] Forwarding upsell analysis request to Upsell Agent`);

    const upsellAgent = agentsConfig.getAgent('upsell');
    const url = agentsConfig.buildUrl('upsell', 'analyze');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_history,
        current_plan,
        rag_suggestion,
        customer_info
      }),
      timeout: upsellAgent.timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upsell Agent error (${response.status}): ${errorText}`);
    }

    const result = await response.json();

    console.log(`[Orchestrator] Upsell Agent response received`);
    res.json(result);

  } catch (err) {
    console.error('[Orchestrator] Upsell analysis error:', err);

    if (err.code === 'ECONNREFUSED') {
      return res.status(503).json({
        error: 'Upsell Agent에 연결할 수 없습니다.',
        detail: 'Upsell Agent가 실행 중인지 확인해주세요 (포트 8008).',
        service: 'Main Backend'
      });
    }

    res.status(500).json({
      error: err.message || 'Upsell analysis failed',
      service: 'Main Backend'
    });
  }
});

/**
 * POST /upsell/analyze/quick
 * 간편 업셀링 분석 (기본 요금제 정보로 빠른 분석)
 */
app.post('/upsell/analyze/quick', async (req, res) => {
  try {
    const { conversation_history, current_plan_name, current_plan_fee } = req.body;

    if (!conversation_history || !Array.isArray(conversation_history)) {
      return res.status(400).json({ error: 'conversation_history array is required' });
    }

    // Upsell Agent 헬스체크
    const upsellAgentHealth = await checkAgentHealth('upsell');

    if (!upsellAgentHealth.ok) {
      return res.status(503).json({
        error: 'Upsell Agent is not available',
        detail: 'Upsell Agent가 실행 중이지 않습니다.',
        service: 'Main Backend'
      });
    }

    console.log(`[Orchestrator] Forwarding quick upsell analysis to Upsell Agent`);

    const upsellAgent = agentsConfig.getAgent('upsell');
    const url = agentsConfig.buildUrl('upsell', 'analyzeQuick');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_history,
        current_plan_name: current_plan_name || 'LTE30+',
        current_plan_fee: current_plan_fee || 35000
      }),
      timeout: upsellAgent.timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upsell Agent error (${response.status}): ${errorText}`);
    }

    const result = await response.json();

    console.log(`[Orchestrator] Upsell Agent quick analysis response received`);
    res.json(result);

  } catch (err) {
    console.error('[Orchestrator] Quick upsell analysis error:', err);

    if (err.code === 'ECONNREFUSED') {
      return res.status(503).json({
        error: 'Upsell Agent에 연결할 수 없습니다.',
        detail: 'Upsell Agent가 실행 중인지 확인해주세요 (포트 8008).',
        service: 'Main Backend'
      });
    }

    res.status(500).json({
      error: err.message || 'Quick upsell analysis failed',
      service: 'Main Backend'
    });
  }
});

/**
 * POST /upsell/intent-only
 * 고객 의중 분석만 수행 (업셀링 판단 제외, 빠른 응답)
 */
app.post('/upsell/intent-only', async (req, res) => {
  try {
    const { conversation_history, current_plan_name, current_plan_fee } = req.body;

    if (!conversation_history || !Array.isArray(conversation_history)) {
      return res.status(400).json({ error: 'conversation_history array is required' });
    }

    // Upsell Agent 헬스체크
    const upsellAgentHealth = await checkAgentHealth('upsell');

    if (!upsellAgentHealth.ok) {
      return res.status(503).json({
        error: 'Upsell Agent is not available',
        detail: 'Upsell Agent가 실행 중이지 않습니다.',
        service: 'Main Backend'
      });
    }

    console.log(`[Orchestrator] Forwarding intent-only analysis to Upsell Agent`);

    const upsellAgent = agentsConfig.getAgent('upsell');
    const url = agentsConfig.buildUrl('upsell', 'intentOnly');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_history,
        current_plan_name: current_plan_name || 'LTE30+',
        current_plan_fee: current_plan_fee || 35000
      }),
      timeout: upsellAgent.timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upsell Agent error (${response.status}): ${errorText}`);
    }

    const result = await response.json();

    console.log(`[Orchestrator] Upsell Agent intent-only response received`);
    res.json(result);

  } catch (err) {
    console.error('[Orchestrator] Intent-only analysis error:', err);

    if (err.code === 'ECONNREFUSED') {
      return res.status(503).json({
        error: 'Upsell Agent에 연결할 수 없습니다.',
        detail: 'Upsell Agent가 실행 중인지 확인해주세요 (포트 8008).',
        service: 'Main Backend'
      });
    }

    res.status(500).json({
      error: err.message || 'Intent-only analysis failed',
      service: 'Main Backend'
    });
  }
});

/**
 * POST /internal/upsell-result (NEW)
 * Upsell Agent가 분석 결과를 푸시하는 내부 엔드포인트
 */
app.post('/internal/upsell-result', (req, res) => {
  const { callId, analysisResult } = req.body;

  if (!ACTIVE_CALL || ACTIVE_CALL.callId !== callId) {
    // 활성 콜이 아니거나 종료된 콜일 수 있음
    console.warn(`[Orchestrator] Received upsell result for inactive call: ${callId}`);
    return res.json({ success: false, reason: 'inactive_call' });
  }

  console.log(`[Orchestrator] Received Upsell Analysis for ${callId} (Msg: ${analysisResult.messageId || 'unknown'})`);

  // 활성 콜 상태 업데이트 (Latest)
  ACTIVE_CALL.upsellAnalysis = analysisResult;

  // [NEW] History에 추가 (메시지 ID 기준)
  if (!ACTIVE_CALL.upsellAnalysisHistory) {
    ACTIVE_CALL.upsellAnalysisHistory = [];
  }

  // 중복 방지 (messageId가 있는 경우)
  if (analysisResult.messageId) {
    const exists = ACTIVE_CALL.upsellAnalysisHistory.find(a => a.messageId === analysisResult.messageId);
    if (!exists) {
      ACTIVE_CALL.upsellAnalysisHistory.push(analysisResult);
    } else {
      // 이미 있으면 업데이트?
      const idx = ACTIVE_CALL.upsellAnalysisHistory.findIndex(a => a.messageId === analysisResult.messageId);
      ACTIVE_CALL.upsellAnalysisHistory[idx] = analysisResult;
    }
  } else {
    // messageId가 없으면 그냥 추가 (Fallback)
    ACTIVE_CALL.upsellAnalysisHistory.push(analysisResult);
  }

  res.json({ success: true });
});

/**
 * POST /internal/rag-result
 * RAG Agent가 분석 결과를 푸시하는 내부 엔드포인트
 */
app.post('/internal/rag-result', (req, res) => {
  const { callId, result } = req.body;

  if (!ACTIVE_CALL || ACTIVE_CALL.callId !== callId) {
    console.warn(`[Orchestrator] Received RAG result for inactive call: ${callId}`);
    return res.json({ success: false, reason: 'inactive_call' });
  }

  // 스킵된 경우 저장하지 않음
  if (result.skipped) {
    console.log(`[Orchestrator] RAG skipped for ${callId}: ${result.reason}`);
    return res.json({ success: true, skipped: true });
  }

  console.log(`[Orchestrator] Received RAG Result for ${callId}`);

  // ragResults 배열 초기화 (없으면)
  if (!ACTIVE_CALL.ragResults) {
    ACTIVE_CALL.ragResults = [];
  }

  // 새 스크립트 추가
  const newScript = {
    id: Date.now(),
    title: result.query.length > 30 ? result.query.substring(0, 30) + '...' : result.query,
    content: result.answer,
    sources: result.sources || [],
    isAutoGenerated: true,
    timestamp: new Date().toISOString()
  };

  ACTIVE_CALL.ragResults.push(newScript);

  res.json({ success: true });
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
      'POST /rag/chat',
      'POST /rag/search',
      'POST /upsell/analyze',
      'POST /upsell/analyze/quick',
      'POST /upsell/intent-only',
      'POST /internal/upsell-result'
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
  console.log('  - GET  /health                  (System health check)');
  console.log('  - GET  /models                  (Available LLM models)');
  console.log('  - POST /analyze                 (Analyze conversation)');
  console.log('  - POST /generate-report         (Generate report)');
  console.log('  - POST /process                 (Full analysis + report)');
  console.log('  - GET  /reports                 (List all reports)');
  console.log('  - GET  /reports/:id             (Get specific report)');
  console.log('  - DELETE /reports/:id           (Delete report)');
  console.log('  - POST /rag/chat                (RAG-based guide)');
  console.log('  - POST /rag/search              (RAG search only)');
  console.log('  - POST /upsell/analyze          (Upsell analysis)');
  console.log('  - POST /upsell/analyze/quick    (Quick upsell analysis)');
  console.log('  - POST /upsell/intent-only      (Intent analysis only)');
  console.log('  - POST /internal/upsell-result  (Receive upsell result)');
  console.log('================================================\n');
});

module.exports = app;
