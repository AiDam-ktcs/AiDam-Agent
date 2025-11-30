require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { analyzeConversation } = require('./services/analyzer');
const { generateReport, createReportMetadata } = require('./services/reporter');
const { getConfig } = require('../../shared/llm-client');
const { validateMessages } = require('../../shared/schemas');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

// 포트 설정
const PORT = process.env.PORT || 8001;

/**
 * Health Check
 * 서비스 상태 확인
 */
app.get('/health', (req, res) => {
  const config = getConfig();
  
  res.json({
    ok: true,
    service: 'Report Agent',
    version: '1.0.0',
    provider: config.provider,
    model: config.model,
    host: config.host,
    timestamp: new Date().toISOString()
  });
});

/**
 * POST /analyze
 * 대화 분석만 수행
 */
app.post('/analyze', async (req, res) => {
  try {
    const { messages, metadata } = req.body;
    
    // 메시지 검증
    validateMessages(messages);
    
    console.log(`[Report Agent] Analyzing conversation with ${messages.length} messages...`);
    
    // LLM 설정 정보 추가
    const config = getConfig();
    const enrichedMetadata = {
      ...metadata,
      provider: config.provider,
      model_used: config.model
    };
    
    // 분석 수행
    const analysis = await analyzeConversation(messages, enrichedMetadata);
    
    console.log('[Report Agent] Analysis completed');
    res.json({ 
      success: true, 
      analysis 
    });
    
  } catch (err) {
    console.error('[Report Agent] Analysis error:', err);
    res.status(500).json({ 
      error: err.message || 'Analysis failed',
      service: 'Report Agent',
      endpoint: '/analyze'
    });
  }
});

/**
 * POST /generate
 * 분석 결과로부터 보고서 생성
 */
app.post('/generate', async (req, res) => {
  try {
    const { analysis, format = 'markdown' } = req.body;
    
    if (!analysis) {
      return res.status(400).json({ 
        error: 'analysis object is required',
        service: 'Report Agent'
      });
    }
    
    console.log('[Report Agent] Generating report...');
    
    // 보고서 생성
    const reportContent = await generateReport(analysis, format);
    
    // 메타데이터 생성
    const reportData = createReportMetadata(analysis, reportContent);
    
    console.log('[Report Agent] Report generated successfully');
    res.json({ 
      success: true, 
      report: {
        id: reportData.id,
        content: reportContent,
        created_at: reportData.created_at,
        metadata: {
          word_count: reportData.word_count,
          char_count: reportData.char_count,
          sections: reportData.sections
        }
      }
    });
    
  } catch (err) {
    console.error('[Report Agent] Report generation error:', err);
    res.status(500).json({ 
      error: err.message || 'Report generation failed',
      service: 'Report Agent',
      endpoint: '/generate'
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
    
    // 메시지 검증
    validateMessages(messages);
    
    // SSE 헤더 설정
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const sendProgress = (step, message, data = null) => {
      res.write(`data: ${JSON.stringify({ step, message, data })}\n\n`);
    };
    
    console.log(`[Report Agent] Processing conversation with ${messages.length} messages...`);
    const userMsgCount = messages.filter(m => m.role === 'user').length;
    const assistantMsgCount = messages.filter(m => m.role === 'assistant').length;
    
    sendProgress(1, `대화 내용 준비 중... (사용자 ${userMsgCount}개, 상담사 ${assistantMsgCount}개)`);
    
    // Step 1: 분석
    console.log('[Report Agent] Step 1: Analyzing...');
    sendProgress(2, 'AI가 대화를 분석하고 있습니다...');
    
    const config = getConfig();
    const enrichedMetadata = {
      ...metadata,
      provider: config.provider,
      model_used: config.model
    };
    
    const analysis = await analyzeConversation(messages, enrichedMetadata);
    
    console.log('[Report Agent] Analysis completed');
    sendProgress(3, `분석 완료! 주요 주제: ${analysis.main_topics?.slice(0, 2).join(', ') || '분석됨'}`, { analysis });
    
    // Step 2: 보고서 생성
    console.log('[Report Agent] Step 2: Generating report...');
    sendProgress(4, '보고서를 생성하고 있습니다...');
    
    const reportContent = await generateReport(analysis);
    const reportData = createReportMetadata(analysis, reportContent);
    
    console.log('[Report Agent] Report generated successfully');
    
    // 최종 결과 전송
    sendProgress(5, '✅ 처리 완료!', {
      success: true,
      reportId: reportData.id,
      analysis,
      report: reportContent,
      created_at: reportData.created_at,
      metadata: {
        word_count: reportData.word_count,
        char_count: reportData.char_count,
        sections: reportData.sections
      }
    });
    
    res.end();
    
  } catch (err) {
    console.error('[Report Agent] Process error:', err);
    
    let errorMessage = '처리 중 오류가 발생했습니다.';
    
    if (err.message.includes('LLM')) {
      errorMessage = 'LLM 서버 연결 오류';
    } else if (err.message.includes('timeout')) {
      errorMessage = '요청 시간 초과';
    } else {
      errorMessage = err.message || errorMessage;
    }
    
    res.write(`data: ${JSON.stringify({ 
      step: -1, 
      message: 'Error', 
      error: errorMessage,
      service: 'Report Agent',
      details: err.stack 
    })}\n\n`);
    res.end();
  }
});

/**
 * 404 핸들러
 */
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    service: 'Report Agent',
    available_endpoints: [
      'GET /health',
      'POST /analyze',
      'POST /generate',
      'POST /process'
    ]
  });
});

/**
 * 에러 핸들러
 */
app.use((err, req, res, next) => {
  console.error('[Report Agent] Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    service: 'Report Agent',
    message: err.message
  });
});

/**
 * 서버 시작
 */
app.listen(PORT, () => {
  const config = getConfig();
  
  console.log('\n=== Report Agent Started ===');
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`Service: Report Agent (대화 분석 및 보고서 생성)`);
  console.log(`LLM Provider: ${config.provider}`);
  console.log(`Model: ${config.model}`);
  console.log(`Host: ${config.host}`);
  console.log('Available Endpoints:');
  console.log('  - GET  /health');
  console.log('  - POST /analyze');
  console.log('  - POST /generate');
  console.log('  - POST /process');
  console.log('=============================\n');
});

module.exports = app;


